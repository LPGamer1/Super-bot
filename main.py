import os
import discord
from discord.ext import commands
from discord import app_commands
import mercadopago
import pymongo
import asyncio
from datetime import datetime
from dotenv import load_dotenv

# Carrega variáveis de ambiente do arquivo .env (se existir)
load_dotenv()

# --- CONFIGURAÇÃO (Variáveis de Ambiente) ---
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
MONGO_URI = os.getenv("MONGO_URI")
MP_ACCESS_TOKEN = os.getenv("MP_ACCESS_TOKEN")
ADMIN_ID = int(os.getenv("ADMIN_ID", 0)) # Seu ID no Discord

# --- INICIALIZAÇÃO DO BOT E BANCO DE DADOS ---
intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents)

# Conexão MongoDB
try:
    mongo_client = pymongo.MongoClient(MONGO_URI)
    db = mongo_client["loja_bot_avancado"]
    collection_estoque = db["estoque"]
    collection_config = db["config"]
    print("✅ Conectado ao MongoDB!")
except Exception as e:
    print(f"❌ Erro ao conectar ao MongoDB: {e}")
    exit()

# Conexão Mercado Pago
try:
    sdk = mercadopago.SDK(MP_ACCESS_TOKEN)
    print("✅ SDK do Mercado Pago inicializado!")
except Exception as e:
    print(f"❌ Erro ao inicializar SDK do Mercado Pago: {e}")
    exit()

# --- FUNÇÕES AUXILIARES DE PAGAMENTO ---
async def gerar_pagamento(valor, produto_nome, user_id):
    try:
        payment_data = {
            "transaction_amount": float(valor),
            "description": f"Compra: {produto_nome}",
            "payment_method_id": "pix",
            "payer": {"email": f"user_{user_id}@discord.com", "first_name": f"User_{user_id}"}
        }
        result = sdk.payment().create(payment_data)
        if result["status"] == 201:
            return result["response"]
        else:
            print(f"Erro Mercado Pago: {result}")
            return None
    except Exception as e:
        print(f"Erro ao gerar pagamento: {e}")
        return None

async def verificar_pagamento(payment_id):
    try:
        payment_info = sdk.payment().get(payment_id)
        if payment_info["status"] == 200:
            return payment_info["response"]["status"] == "approved"
        else:
            print(f"Erro ao verificar pagamento: {payment_info}")
            return False
    except Exception as e:
        print(f"Erro na verificação do pagamento: {e}")
        return False

# --- CLASSES DE INTERFACE (VIEWS E SELECTS) ---

class LojaView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        self.add_item(LojaSelect())

class LojaSelect(discord.ui.Select):
    def __init__(self):
        options = []
        # Busca produtos com estoque > 0
        produtos = collection_estoque.find({"estoque": {"$gt": 0}})
        
        if collection_estoque.count_documents({"estoque": {"$gt": 0}}) == 0:
            options.append(discord.SelectOption(label="Nenhum produto disponível", value="nenhum", emoji="🚫"))
        else:
            for p in produtos:
                emoji = p.get('emoji', '📦') # Emoji padrão se não tiver
                label = f"{p['nome']}"
                description = f"R$ {p['valor']:.2f} | Estoque: {p['estoque']}"
                options.append(discord.SelectOption(label=label, description=description, value=p['_id'], emoji=emoji))
        
        super().__init__(placeholder="Selecione um produto", min_values=1, max_values=1, options=options)

    async def callback(self, interaction: discord.Interaction):
        if self.values[0] == "nenhum":
            await interaction.response.send_message("Não há produtos para comprar no momento.", ephemeral=True)
            return

        # Busca o produto selecionado
        produto_id = self.values[0]
        produto = collection_estoque.find_one({"_id": produto_id})
        
        if not produto:
            await interaction.response.send_message("Produto não encontrado.", ephemeral=True)
            return

        # Cria o embed de confirmação
        embed = discord.Embed(title=f"Confirmar Compra: {produto['nome']}", color=discord.Color.green())
        embed.add_field(name="Valor", value=f"R$ {produto['valor']:.2f}", inline=True)
        embed.add_field(name="Descrição", value=produto.get('descricao', 'Sem descrição'), inline=False)
        if produto.get('imagem_url'):
            embed.set_thumbnail(url=produto['imagem_url'])
        
        # Adiciona o botão de confirmação
        view = ConfirmacaoView(produto)
        await interaction.response.send_message(embed=embed, view=view, ephemeral=True)

class ConfirmacaoView(discord.ui.View):
    def __init__(self, produto):
        super().__init__(timeout=300) # 5 minutos para confirmar
        self.produto = produto

    @discord.ui.button(label="Confirmar Compra", style=discord.ButtonStyle.success, emoji="✅")
    async def confirmar_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer(ephemeral=True)
        self.stop() # Para o timeout da view

        # Verifica estoque novamente
        produto_atualizado = collection_estoque.find_one({"_id": self.produto["_id"], "estoque": {"$gt": 0}})
        if not produto_atualizado:
            await interaction.followup.send("❌ Produto esgotado.", ephemeral=True)
            return

        pagamento = await gerar_pagamento(self.produto['valor'], self.produto['nome'], interaction.user.id)
        
        if not pagamento:
            await interaction.followup.send("❌ Erro ao gerar pagamento. Tente novamente.", ephemeral=True)
            return

        pix_copia_cola = pagamento['point_of_interaction']['transaction_data']['qr_code']
        qr_code_base64 = pagamento['point_of_interaction']['transaction_data']['qr_code_base64']
        payment_id = pagamento['id']
        
        embed_pix = discord.Embed(title=f"Pagamento Pix: {self.produto['nome']}", description=f"Valor: **R${self.produto['valor']:.2f}**\n\nCopie o código abaixo e pague no seu banco via Pix Copia e Cola.", color=discord.Color.blue())
        await interaction.followup.send(embed=embed_pix, content=f"```{pix_copia_cola}```", ephemeral=True)
        
        # Loop de verificação
        start_time = datetime.now()
        pago = False
        while (datetime.now() - start_time).seconds < 600: # 10 minutos
            if await verificar_pagamento(payment_id):
                pago = True
                break
            await asyncio.sleep(5)
        
        if pago:
            # Tenta decrementar o estoque e pegar o conteúdo
            item_vendido = collection_estoque.find_one_and_update(
                {"_id": self.produto["_id"], "estoque": {"$gt": 0}},
                {"$inc": {"estoque": -1}, "$push": {"vendas": {"comprador_id": interaction.user.id, "data": datetime.now(), "valor": self.produto['valor']}}},
                return_document=pymongo.ReturnDocument.AFTER
            )
            
            if item_vendido:
                try:
                    dm = await interaction.user.create_dm()
                    embed_entrega = discord.Embed(title="✅ Pagamento Aprovado!", description=f"Obrigado pela compra do **{self.produto['nome']}**!", color=discord.Color.gold())
                    embed_entrega.add_field(name="Seu Produto", value=f"```{item_vendido['conteudo']}```", inline=False)
                    await dm.send(embed=embed_entrega)
                    await interaction.followup.send("✅ Pagamento confirmado! Produto enviado na sua DM.", ephemeral=True)
                except:
                    await interaction.followup.send(f"✅ Pagamento confirmado! Mas sua DM está fechada. Aqui está: ||{item_vendido['conteudo']}||", ephemeral=True)
            else:
                await interaction.followup.send("⚠️ Pagamento recebido, mas o produto acabou de sair de estoque. Contate o admin.", ephemeral=True)
        else:
            await interaction.followup.send("⏰ Tempo de pagamento expirou.", ephemeral=True)


# --- COMANDOS DO BOT ---

@bot.event
async def on_ready():
    print(f'Bot logado como {bot.user}')
    try:
        synced = await bot.tree.sync()
        print(f"Comandos sincronizados: {len(synced)}")
    except Exception as e:
        print(f"Erro ao sincronizar: {e}")

# 1. Adicionar Produto (Admin)
@bot.tree.command(name="adicionar_produto", description="Adiciona um novo produto ao estoque.")
@app_commands.describe(
    nome="Nome do produto (ex: Nitro)",
    valor="Preço do produto (ex: 15.50)",
    estoque="Quantidade inicial em estoque",
    conteudo="O que será entregue (código/texto)",
    descricao="Breve descrição do produto",
    emoji="Emoji para o menu (ex: 💎)",
    imagem_url="URL de uma imagem para o produto"
)
async def adicionar_produto(interaction: discord.Interaction, nome: str, valor: float, estoque: int, conteudo: str, descricao: str = "", emoji: str = "📦", imagem_url: str = ""):
    if interaction.user.id != ADMIN_ID:
        await interaction.response.send_message("❌ Apenas o dono pode fazer isso.", ephemeral=True)
        return

    item = {
        "nome": nome,
        "valor": valor,
        "estoque": estoque,
        "conteudo": conteudo,
        "descricao": descricao,
        "emoji": emoji,
        "imagem_url": imagem_url,
        "vendas": []
    }
    collection_estoque.insert_one(item)
    await interaction.response.send_message(f"✅ Produto **{nome}** adicionado com {estoque} unidades por R${valor:.2f}!", ephemeral=True)

# 2. Configurar Loja (Admin)
@bot.tree.command(name="setup_loja", description="Configura a aparência do painel da loja.")
@app_commands.describe(
    titulo="Título do Embed da loja",
    descricao="Descrição do Embed da loja",
    imagem_url="URL da imagem principal do embed",
    thumbnail_url="URL do ícone pequeno do embed",
    footer_text="Texto do rodapé do embed"
)
async def setup_loja(interaction: discord.Interaction, titulo: str = "Minha Loja", descricao: str = "Bem-vindo à nossa loja!", imagem_url: str = "", thumbnail_url: str = "", footer_text: str = ""):
    if interaction.user.id != ADMIN_ID:
        await interaction.response.send_message("❌ Apenas o dono pode fazer isso.", ephemeral=True)
        return
    
    config = {
        "titulo": titulo,
        "descricao": descricao,
        "imagem_url": imagem_url,
        "thumbnail_url": thumbnail_url,
        "footer_text": footer_text
    }
    collection_config.update_one({"_id": "config_loja"}, {"$set": config}, upsert=True)
    await interaction.response.send_message("✅ Configurações da loja atualizadas!", ephemeral=True)

# 3. Exibir Painel de Vendas (Admin)
@bot.tree.command(name="painel_vendas", description="Exibe o painel de vendas no canal atual.")
async def painel_vendas(interaction: discord.Interaction):
    if interaction.user.id != ADMIN_ID:
        await interaction.response.send_message("❌ Apenas o dono pode fazer isso.", ephemeral=True)
        return
    
    config = collection_config.find_one({"_id": "config_loja"})
    if not config:
        config = {"titulo": "Minha Loja", "descricao": "Bem-vindo!", "imagem_url": "", "thumbnail_url": "", "footer_text": ""}

    embed = discord.Embed(title=config.get("titulo"), description=config.get("descricao"), color=discord.Color.blue())
    if config.get("imagem_url"):
        embed.set_image(url=config.get("imagem_url"))
    if config.get("thumbnail_url"):
        embed.set_thumbnail(url=config.get("thumbnail_url"))
    if config.get("footer_text"):
        embed.set_footer(text=config.get("footer_text"))
    
    await interaction.channel.send(embed=embed, view=LojaView())
    await interaction.response.send_message("✅ Painel de vendas enviado!", ephemeral=True)

# 4. Reabastecer Estoque (Admin)
@bot.tree.command(name="reabastecer", description="Adiciona mais estoque a um produto.")
@app_commands.describe(nome_produto="Nome exato do produto", quantidade="Quantidade a adicionar")
async def reabastecer(interaction: discord.Interaction, nome_produto: str, quantidade: int):
    if interaction.user.id != ADMIN_ID:
        await interaction.response.send_message("❌ Apenas o dono pode fazer isso.", ephemeral=True)
        return
    
    result = collection_estoque.update_one({"nome": nome_produto}, {"$inc": {"estoque": quantidade}})
    if result.modified_count > 0:
        await interaction.response.send_message(f"✅ Estoque de **{nome_produto}** aumentado em {quantidade} unidades.", ephemeral=True)
    else:
        await interaction.response.send_message(f"❌ Produto **{nome_produto}** não encontrado.", ephemeral=True)

# 5. Remover Produto (Admin)
@bot.tree.command(name="remover_produto", description="Remove um produto do estoque.")
@app_commands.describe(nome_produto="Nome exato do produto a remover")
async def remover_produto(interaction: discord.Interaction, nome_produto: str):
    if interaction.user.id != ADMIN_ID:
        await interaction.response.send_message("❌ Apenas o dono pode fazer isso.", ephemeral=True)
        return
    
    result = collection_estoque.delete_one({"nome": nome_produto})
    if result.deleted_count > 0:
        await interaction.response.send_message(f"✅ Produto **{nome_produto}** removido.", ephemeral=True)
    else:
        await interaction.response.send_message(f"❌ Produto **{nome_produto}** não encontrado.", ephemeral=True)


bot.run(DISCORD_TOKEN)
