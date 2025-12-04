import os
import discord
from discord.ext import commands
import pymongo
import asyncio
from datetime import datetime
from dotenv import load_dotenv
from aiohttp import web
import random

load_dotenv()

# --- CONFIGURAÇÃO ---
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
MONGO_URI = os.getenv("MONGO_URI")
ADMIN_ID = int(os.getenv("ADMIN_ID", 0))
CHAVE_PIX = os.getenv("CHAVE_PIX") # Sua chave (CPF, Email ou Aleatória)
NOME_TITULAR = os.getenv("NOME_TITULAR") # Nome que aparece no comprovante

# --- INICIALIZAÇÃO ---
intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents)

# Banco de Dados
mongo_client = pymongo.MongoClient(MONGO_URI)
db = mongo_client["loja_nubank"]
collection_estoque = db["estoque"]
collection_pendentes = db["pagamentos_pendentes"] # Guarda quem deve pagar quanto

# --- WEBSERVER (Para ouvir o Celular) ---
async def handle_webhook(request):
    try:
        data = await request.json()
        # O MacroDroid vai enviar um JSON: {"mensagem": "Você recebeu uma transferência de R$ 10,03 de..."}
        mensagem = data.get("message", "")
        print(f"🔔 Notificação recebida: {mensagem}")

        # Lógica simples para extrair valor (Adapte conforme a notificação do seu banco)
        # Exemplo notificação Nubank: "Transferência recebida! Você recebeu R$ 10,03 de João..."
        import re
        # Procura por "R$ 10,03" ou "10,03"
        match = re.search(r'R\$\s?(\d+[,.]\d{2})', mensagem)
        
        if match:
            valor_str = match.group(1).replace('.', '').replace(',', '.') # Transforma 10,03 em 10.03 float
            valor_recebido = float(valor_str)
            
            # Procura quem tinha que pagar esse valor EXATO
            pagamento = collection_pendentes.find_one({"valor_esperado": valor_recebido, "status": "pendente"})
            
            if pagamento:
                await entregar_produto(pagamento)
                return web.Response(text="Pagamento Processado")
            else:
                print(f"⚠️ Valor {valor_recebido} recebido, mas ninguém estava esperando esse valor exato.")
        
        return web.Response(text="OK")
    except Exception as e:
        print(f"Erro no webhook: {e}")
        return web.Response(status=500)

async def entregar_produto(pagamento):
    # Marca como pago
    collection_pendentes.update_one({"_id": pagamento["_id"]}, {"$set": {"status": "pago"}})
    
    # Baixa estoque
    from bson.objectid import ObjectId
    produto = collection_estoque.find_one_and_update(
        {"_id": ObjectId(pagamento["produto_id"])},
        {"$inc": {"estoque": -1}},
        return_document=pymongo.ReturnDocument.AFTER
    )
    
    # Tenta avisar no canal do ticket
    channel = bot.get_channel(pagamento["channel_id"])
    if channel:
        await channel.send(f"✅ **Pagamento de R$ {pagamento['valor_esperado']:.2f} Identificado!**\n\nSeu produto:\n```{produto['conteudo']}```", view=FecharTicketView())
    else:
        # Se o canal sumiu, tenta DM
        user = await bot.fetch_user(pagamento["user_id"])
        await user.send(f"Seu pagamento de R$ {pagamento['valor_esperado']} foi confirmado!\nProduto: {produto['conteudo']}")

# --- DISCORD VIEWS ---
class FecharTicketView(discord.ui.View):
    def __init__(self): super().__init__(timeout=None)
    @discord.ui.button(label="Fechar Ticket 🔒", style=discord.ButtonStyle.danger)
    async def fechar(self, interaction: discord.Interaction, button):
        await interaction.channel.delete()

class ConfirmacaoView(discord.ui.View):
    def __init__(self, produto):
        super().__init__(timeout=None)
        self.produto = produto

    @discord.ui.button(label="Comprar (Pix Nubank)", style=discord.ButtonStyle.blurple, emoji="🟣")
    async def comprar(self, interaction: discord.Interaction, button):
        await interaction.response.defer(ephemeral=True)
        
        # Gera centavos aleatórios (entre 0.01 e 0.99) para identificar
        centavos = random.randint(1, 99) / 100
        valor_final = self.produto['valor'] + centavos
        valor_final = round(valor_final, 2)
        
        # Verifica se já tem alguém pagando esse valor agora (para não conflitar)
        while collection_pendentes.find_one({"valor_esperado": valor_final, "status": "pendente"}):
            centavos = random.randint(1, 99) / 100
            valor_final = self.produto['valor'] + centavos
            valor_final = round(valor_final, 2)

        # Cria Ticket
        guild = interaction.guild
        overwrites = {
            guild.default_role: discord.PermissionOverwrite(read_messages=False),
            interaction.user: discord.PermissionOverwrite(read_messages=True),
            guild.me: discord.PermissionOverwrite(read_messages=True)
        }
        ticket = await guild.create_text_channel(name=f"compra-{interaction.user.name}", overwrites=overwrites)
        
        # Salva a pendência
        collection_pendentes.insert_one({
            "user_id": interaction.user.id,
            "produto_id": self.produto["_id"],
            "valor_esperado": valor_final,
            "channel_id": ticket.id,
            "status": "pendente",
            "criado_em": datetime.now()
        })
        
        msg = f"""
        # 🟣 Pagamento Nubank (Pessoa Física)
        
        Para confirmar automaticamente, você deve transferir o valor **EXATO** (com os centavos).
        
        💰 Valor Obrigatório: **R$ {valor_final:.2f}**
        🔑 Chave Pix: `{CHAVE_PIX}`
        👤 Titular: **{NOME_TITULAR}**
        
        ⚠️ **ATENÇÃO:** Se você enviar R$ {self.produto['valor']:.2f} ou valor diferente, o bot **NÃO** vai entregar. Envie **R$ {valor_final:.2f}**.
        """
        await ticket.send(interaction.user.mention)
        await ticket.send(msg)
        await interaction.followup.send(f"Ticket criado: {ticket.mention}", ephemeral=True)

class LojaView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        self.add_item(LojaSelect())

class LojaSelect(discord.ui.Select):
    def __init__(self):
        options = []
        produtos = collection_estoque.find({"estoque": {"$gt": 0}})
        for p in produtos:
            options.append(discord.SelectOption(label=p['nome'], description=f"Base: R$ {p['valor']:.2f}", value=str(p['_id'])))
        if not options: options.append(discord.SelectOption(label="Vazio", value="n"))
        super().__init__(placeholder="Escolha o produto", options=options)

    async def callback(self, interaction):
        if self.values[0] == "n": return await interaction.response.send_message("Vazio", ephemeral=True)
        from bson.objectid import ObjectId
        produto = collection_estoque.find_one({"_id": ObjectId(self.values[0])})
        await interaction.response.send_message(view=ConfirmacaoView(produto), ephemeral=True)

# --- COMANDOS E START ---
@bot.tree.command(name="painel")
async def painel(interaction: discord.Interaction):
    if interaction.user.id == ADMIN_ID: await interaction.channel.send("Loja Nubank", view=LojaView())

@bot.tree.command(name="add_prod")
async def add(interaction: discord.Interaction, nome: str, valor: float, estoque: int, conteudo: str):
    if interaction.user.id == ADMIN_ID: 
        collection_estoque.insert_one({"nome": nome, "valor": valor, "estoque": estoque, "conteudo": conteudo})
        await interaction.response.send_message("Add!")

async def run_webserver():
    app = web.Application()
    app.router.add_post('/webhook', handle_webhook)
    runner = web.AppRunner(app)
    await runner.setup()
    # O Render fornece a porta na variável PORT, padrão 8080 se não tiver
    port = int(os.environ.get("PORT", 8080))
    site = web.TCPSite(runner, '0.0.0.0', port)
    await site.start()
    print(f"🌍 Webserver ouvindo na porta {port}")

async def main():
    async with bot:
        await run_webserver()
        await bot.start(DISCORD_TOKEN)

if __name__ == "__main__":
    asyncio.run(main())
