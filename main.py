import os
import discord
from discord.ext import commands
from discord import app_commands
import pymongo
import asyncio
from datetime import datetime
from dotenv import load_dotenv
from aiohttp import web
import re

# Carrega as variáveis do .env (ou do painel do Render)
load_dotenv()

# --- CONFIGURAÇÕES ---
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
MONGO_URI = os.getenv("MONGO_URI")
ADMIN_ID = int(os.getenv("ADMIN_ID", 0))    # ID do Dono do Bot
CHAVE_PIX = os.getenv("CHAVE_PIX")          # Sua chave Pix (CPF/Email/Aleatória)
NOME_TITULAR = os.getenv("NOME_TITULAR")    # Seu Nome (para o cliente conferir)

# --- INICIALIZAÇÃO ---
intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents)

# Conexão Banco de Dados (MongoDB)
try:
    mongo_client = pymongo.MongoClient(MONGO_URI)
    db = mongo_client["loja_nubank_final"]
    collection_estoque = db["estoque"]
    collection_pendentes = db["pendentes"] # Guarda quem está tentando comprar agora
    collection_vendas = db["historico_vendas"] # Guarda o histórico de quem já pagou
    print("✅ Banco de Dados Conectado!")
except Exception as e:
    print(f"❌ Erro ao conectar no Banco: {e}")
    exit()

# --- SISTEMA DE WEBSERVER (Ouvindo o Celular/MacroDroid) ---

async def handle_webhook(request):
    """ Recebe a notificação do MacroDroid quando cai um Pix """
    try:
        data = await request.json()
        mensagem = data.get("message", "")
        print(f"🔔 Notificação Recebida: {mensagem}")

        # Busca o valor na mensagem (ex: "R$ 10,01" ou "10,01")
        # O Regex procura números no formato XX,XX ou XX.XX
        match = re.search(r'R\$\s?(\d+[,.]\d{2})', mensagem)
        
        if match:
            # Transforma "10,01" em 10.01 (float)
            valor_str = match.group(1).replace('.', '').replace(',', '.')
            valor_recebido = float(valor_str)
            
            print(f"💰 Valor identificado: R$ {valor_recebido}")

            # Busca no banco quem deveria pagar EXATAMENTE esse valor
            # O status deve ser 'pendente'
            pagamento = collection_pendentes.find_one({
                "valor_esperado": valor_recebido, 
                "status": "pendente"
            })
            
            if pagamento:
                await entregar_produto(pagamento)
                return web.Response(text="Pagamento Confirmado e Entregue")
            else:
                print(f"⚠️ Recebido R$ {valor_recebido}, mas ninguém estava na fila com esse valor exato agora.")
                return web.Response(text="Valor recebido, mas sem pedido pendente.")
            
        return web.Response(text="Formato de valor não encontrado.")
    except Exception as e:
        print(f"Erro Crítico no Webhook: {e}")
        return web.Response(status=500)

async def entregar_produto(pagamento):
    """ Finaliza a venda, entrega o produto e libera o centavo """
    user_id = pagamento["user_id"]
    produto_id = pagamento["produto_id"]
    
    # 1. Move de 'pendentes' para 'historico_vendas' (Isso libera o valor para outro usar)
    collection_pendentes.delete_one({"_id": pagamento["_id"]})
    
    collection_vendas.insert_one({
        "user_id": user_id,
        "produto_id": produto_id,
        "valor_pago": pagamento["valor_esperado"],
        "data": datetime.now()
    })
    
    # 2. Baixa o estoque
    from bson.objectid import ObjectId
    produto = collection_estoque.find_one_and_update(
        {"_id": ObjectId(produto_id)},
        {"$inc": {"estoque": -1}},
        return_document=pymongo.ReturnDocument.AFTER
    )
    
    # 3. Avisa no canal do Ticket
    channel = bot.get_channel(pagamento["channel_id"])
    if channel:
        try:
            embed = discord.Embed(title="✅ Pagamento Aprovado!", color=discord.Color.green())
            embed.description = f"Confirmamos o recebimento de **R$ {pagamento['valor_esperado']:.2f}**."
            embed.add_field(name="📦 Seu Produto", value=f"```{produto['conteudo']}```", inline=False)
            embed.set_footer(text="Obrigado pela compra! Pode fechar este ticket.")
            
            await channel.send(f"<@{user_id}>", embed=embed, view=FecharTicketView())
        except Exception as e:
            print(f"Erro ao enviar mensagem no ticket: {e}")

# --- INTERFACE VISUAL (BOTOES E MENUS) ---

class FecharTicketView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Cancelar / Fechar Ticket 🔒", style=discord.ButtonStyle.danger, custom_id="fechar_ticket_btn")
    async def fechar(self, interaction: discord.Interaction, button: discord.ui.Button):
        # Ao fechar, precisamos garantir que o centavo preso seja liberado
        # Deletamos qualquer pendencia associada a este canal
        collection_pendentes.delete_many({"channel_id": interaction.channel.id})
        
        await interaction.response.send_message("Cancelando pedido e liberando o valor...", ephemeral=True)
        await asyncio.sleep(2)
        await interaction.channel.delete()

class ConfirmacaoView(discord.ui.View):
    def __init__(self, produto):
        super().__init__(timeout=None)
        self.produto = produto

    @discord.ui.button(label="Comprar (Pix Nubank)", style=discord.ButtonStyle.blurple, emoji="🟣")
    async def comprar(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer(ephemeral=True)
        
        # --- LÓGICA DE FILA INFINITA DE CENTAVOS ---
        centavos = 1 # Começa tentando +0.01
        valor_final = 0.0
        
        # Loop para achar um valor livre
        while True:
            adicional = centavos / 100.0
            valor_final = round(self.produto['valor'] + adicional, 2)
            
            # Verifica se alguém já está com esse ticket aberto (status: pendente)
            existe = collection_pendentes.find_one({"valor_esperado": valor_final, "status": "pendente"})
            
            if not existe:
                # Achamos um valor livre!
                break
            
            # Se ocupado, tenta o próximo (1 -> 2 -> 3...)
            centavos += 1
            
            # Trava de segurança para não travar o bot em loop infinito
            if centavos > 2000: 
                await interaction.followup.send("⚠️ O sistema está muito cheio agora. Tente em alguns instantes.", ephemeral=True)
                return

        # --- CRIAÇÃO DO TICKET ---
        guild = interaction.guild
        overwrites = {
            guild.default_role: discord.PermissionOverwrite(read_messages=False),
            interaction.user: discord.PermissionOverwrite(read_messages=True, send_messages=True),
            guild.me: discord.PermissionOverwrite(read_messages=True, send_messages=True)
        }
        
        nome_canal = f"compra-{interaction.user.name}-{centavos}" # Nome único
        ticket = await guild.create_text_channel(name=nome_canal, overwrites=overwrites)
        
        # Salva no Banco (Reserva o Valor)
        collection_pendentes.insert_one({
            "user_id": interaction.user.id,
            "produto_id": self.produto["_id"],
            "valor_esperado": valor_final,
            "channel_id": ticket.id,
            "status": "pendente",
            "criado_em": datetime.now()
        })
        
        # Mensagem Bonita no Ticket
        embed_pag = discord.Embed(title="🟣 Pagamento Nubank", description="Siga as instruções abaixo para receber seu produto automaticamente.", color=discord.Color.purple())
        embed_pag.add_field(name="💸 Valor Obrigatório", value=f"```R$ {valor_final:.2f}```", inline=False)
        embed_pag.add_field(name="🔑 Chave Pix", value=f"```{CHAVE_PIX}```", inline=False)
        embed_pag.add_field(name="👤 Nome do Titular", value=f"**{NOME_TITULAR}**", inline=False)
        embed_pag.set_footer(text="⚠️ Envie o valor EXATO. Se enviar diferente, o bot não entrega.")
        
        await ticket.send(f"{interaction.user.mention}", embed=embed_pag, view=FecharTicketView())
        await interaction.followup.send(f"✅ Ticket criado! Vá para {ticket.mention}", ephemeral=True)

class LojaSelect(discord.ui.Select):
    def __init__(self):
        options = []
        # Pega produtos com estoque positivo
        produtos = collection_estoque.find({"estoque": {"$gt": 0}})
        
        # Converte cursor para lista para verificar se está vazio
        lista_produtos = list(produtos)
        
        if not lista_produtos:
            options.append(discord.SelectOption(label="Sem estoque no momento", value="vazio", emoji="🚫"))
        else:
            for p in lista_produtos:
                options.append(discord.SelectOption(
                    label=p['nome'], 
                    description=f"R$ {p['valor']:.2f} | Estoque: {p['estoque']}", 
                    value=str(p['_id']), 
                    emoji="📦"
                ))
            
        super().__init__(placeholder="Selecione um produto...", min_values=1, max_values=1, options=options)

    async def callback(self, interaction: discord.Interaction):
        if self.values[0] == "vazio":
            await interaction.response.send_message("Nenhum produto disponível.", ephemeral=True)
            return

        from bson.objectid import ObjectId
        produto = collection_estoque.find_one({"_id": ObjectId(self.values[0])})
        
        if not produto:
            await interaction.response.send_message("Produto não encontrado (talvez foi removido).", ephemeral=True)
            return

        embed = discord.Embed(title=f"🛒 {produto['nome']}", color=discord.Color.blue())
        embed.add_field(name="Preço", value=f"R$ {produto['valor']:.2f}")
        embed.add_field(name="Descrição", value=f"Entrega automática via Pix Nubank.")
        
        await interaction.response.send_message(embed=embed, view=ConfirmacaoView(produto), ephemeral=True)

class LojaView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        self.add_item(LojaSelect())

# --- COMANDOS DO ADMIN ---

@bot.tree.command(name="painel_vendas", description="Envia o painel de compras")
async def painel(interaction: discord.Interaction):
    if interaction.user.id != ADMIN_ID:
        await interaction.response.send_message("Você não é admin.", ephemeral=True)
        return
        
    await interaction.channel.send(
        "🛍️ **LOJA AUTOMÁTICA**\nSelecione um produto abaixo para iniciar a compra via Pix Nubank.", 
        view=LojaView()
    )
    await interaction.response.send_message("Painel enviado!", ephemeral=True)

@bot.tree.command(name="adicionar_produto", description="Adiciona um novo item")
async def add_prod(interaction: discord.Interaction, nome: str, valor: float, estoque: int, conteudo: str):
    if interaction.user.id != ADMIN_ID:
        await interaction.response.send_message("Sem permissão.", ephemeral=True)
        return

    collection_estoque.insert_one({
        "nome": nome,
        "valor": valor,
        "estoque": estoque,
        "conteudo": conteudo
    })
    await interaction.response.send_message(f"✅ Produto **{nome}** (R$ {valor}) criado!", ephemeral=True)

# --- START DO BOT + WEBSERVER ---

async def run_webserver():
    """ Inicia o servidor que ouve o MacroDroid """
    app = web.Application()
    app.router.add_post('/webhook', handle_webhook)
    
    runner = web.AppRunner(app)
    await runner.setup()
    
    # Render.com define a porta automaticamente na variavel PORT
    port = int(os.environ.get("PORT", 8080))
    site = web.TCPSite(runner, '0.0.0.0', port)
    await site.start()
    print(f"🌍 Webserver Online na porta {port}")

async def main():
    async with bot:
        # Inicia o Webserver e o Bot juntos
        await run_webserver()
        await bot.start(DISCORD_TOKEN)

@bot.event
async def on_ready():
    await bot.tree.sync()
    print(f"🤖 Bot logado como {bot.user}")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Bot desligado.")
