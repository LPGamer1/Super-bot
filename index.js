const Discord = require("discord.js");
const client = new Discord.Client({ intents: 32767 });
const mercadopago = require("mercadopago");
const axios = require("axios");
const moment = require("moment");
const { joinVoiceChannel } = require('@discordjs/voice');
const mongoose = require("mongoose");
const express = require('express');

// Importar os Modelos do MongoDB
const { Product, Config, Coupon, Stats } = require("./models.js");

// --- CONFIGURAÇÃO PARA O RENDER.COM (Keep Alive) ---
const app = express();
app.get('/', (req, res) => res.send('Bot Online via Render!'));
app.listen(process.env.PORT || 3000, () => console.log("🌐 Web server online."));
// ---------------------------------------------------

moment.locale("pt-br");

// Conexão com MongoDB
mongoose.connect(process.env.MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("✅ - Conectado ao MongoDB!"))
  .catch((err) => console.log("❌ - Erro ao conectar no Mongo:", err));

client.login(process.env.TOKEN); // Usar variável de ambiente

// Variáveis de Cache para evitar consultas excessivas ao banco
let botConfigCache = {};

async function refreshConfig() {
    // Busca a config. Se não existir, cria uma padrão.
    let conf = await Config.findOne(); 
    if (!conf) {
        conf = await Config.create({ nomebot: "Loja", cor: "#000000" });
    }
    botConfigCache = conf;
    return conf;
}

client.once('ready', async () => {
    console.log("✅ - Estou online!");
    await refreshConfig();
    
    // Configurar canal de voz
    if (process.env.CANAL_VOZ) {
        let channel = client.channels.cache.get(process.env.CANAL_VOZ);
        if (channel) {
            joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
            });
            console.log("✅ - Entrei no canal de voz.");
        }
    }
    
    // Status
    let activities = [`Vendas automáticas`, `CUPOM: NATAL`, `10% OFF`], i = 0;
    setInterval(() => client.user.setActivity(`${activities[i++ % activities.length]}`, { type: "STREAMING", url: "https://www.twitch.tv/discord" }), 30000);
    client.user.setStatus("dnd");
});

client.on('messageCreate', async message => {
    if (message.author.bot || message.channel.type == 'dm') return;
    
    const prefix = process.env.PREFIX || "/"; // Use env var ou default
    if (!message.content.toLowerCase().startsWith(prefix)) return;

    const args = message.content.trim().slice(prefix.length).split(/ +/g);
    const command = args.shift().toLowerCase();

    try {
        // OBS: Você precisará reescrever os arquivos dentro de ./commands 
        // para usar Mongoose em vez de quick.db
        const commandFile = require(`./commands/${command}.js`);
        commandFile.run(client, message, args); 
    } catch (err) {
        // Ignora erro se comando não existe
    }
});

// --- LÓGICA DE COMPRA ADAPTADA PARA MONGODB ---
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;
    
    // Tenta achar o produto pelo ID do botão (customId)
    // No quick.db era db.get(id). No Mongo é Product.findOne
    const eprod = await Product.findOne({ id: interaction.customId });

    // Se não for um produto, verifique se são botões de controle (cancelar, pix, etc)
    // Se for produto:
    if (eprod) {
        const quantidadeEstoque = eprod.conta.length;

        const row = new Discord.MessageActionRow()
            .addComponents(
                new Discord.MessageButton()
                    .setCustomId(interaction.customId)
                    .setLabel('Comprar')
                    .setEmoji('🛒')
                    .setStyle('SECONDARY'),
            );
            
        const embed = new Discord.MessageEmbed()
            .setTitle(`${botConfigCache.nomebot || 'Loja'} | Produto`)
            .setDescription(`\`\`\`${eprod.desc}\`\`\`\n🛒 **Nome:** **__${eprod.nome}__**\n💸 **Preço:** **R$${eprod.preco}**\n📦 **Estoque:** **${quantidadeEstoque}**`)
            .setColor(botConfigCache.cor || '#000000')
            .setFooter("Para comprar clique no botão abaixo.");
            
        if (botConfigCache.banner) embed.setImage(botConfigCache.banner);
        
        interaction.message.edit({ embeds: [embed], components: [row] });

        if (quantidadeEstoque < 1) {
            return interaction.reply({ content: `**Estamos sem estoque no momento.**`, ephemeral: true });
        }

        // Sistema de Carrinho
        const canalNome = "🛒・carrinho-" + interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "");
        
        // Verifica se já existe canal (cache do discord)
        if (interaction.guild.channels.cache.find(c => c.name === canalNome)) {
            return interaction.reply({ content: `Você já tem um carrinho aberto!`, ephemeral: true });
        }
        
        interaction.deferUpdate();

        const parentCategory = botConfigCache.catecarrinho; 
        
        interaction.guild.channels.create(canalNome, {
            type: "GUILD_TEXT",
            parent: parentCategory ? parentCategory : null,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: ["VIEW_CHANNEL", "SEND_MESSAGES"] },
                { id: interaction.user.id, allow: ["VIEW_CHANNEL"], deny: ["SEND_MESSAGES"] }
            ]
        }).then(async c => {
            // Timer para deletar carrinho
            let timerDeletar = setTimeout(() => c.delete().catch(() => {}), 300000); // 5 min
            
            c.setTopic(interaction.user.id);
            c.send({ content: `<@${interaction.user.id}>` }).then(m => setTimeout(() => m.delete(), 1000));

            const row2 = new Discord.MessageActionRow()
                .addComponents(
                    new Discord.MessageButton().setCustomId('pix').setLabel("Finalizar compra").setEmoji("🛒").setStyle("SECONDARY"),
                    new Discord.MessageButton().setCustomId('cancelar').setLabel("Cancelar").setStyle("DANGER").setEmoji("✖️")
                );

            const embedCarrinho = new Discord.MessageEmbed()
                .setTitle(`COMPRANDO ${eprod.nome}`)
                .setDescription(`Seja bem-vindo. Termos: <#${botConfigCache.canaltermos || '000'}>\nClique em Finalizar Compra.`)
                .setColor(botConfigCache.cor || '#000000');

            const msgCarrinho = await c.send({ embeds: [embedCarrinho], components: [row2] });

            const collector = msgCarrinho.channel.createMessageComponentCollector({ filter: i => i.user.id === interaction.user.id });

            collector.on("collect", async interaction2 => {
                
                if (interaction2.customId == 'cancelar') {
                    interaction2.reply("Carrinho cancelado.");
                    setTimeout(() => c.delete().catch(() => {}), 1000);
                    return;
                }

                if (interaction2.customId == 'pix') {
                    // Resetar timer
                    clearTimeout(timerDeletar);
                    timerDeletar = setTimeout(() => c.delete().catch(() => {}), 300000);
                    
                    await interaction2.message.delete().catch(()=>{});

                    let quantidadeCompra = 1;
                    let precoAtual = eprod.preco;
                    let cupomAplicado = null;

                    // Painel de controle da compra
                    const createControlRow = (disabled = false) => {
                        return new Discord.MessageActionRow().addComponents(
                            new Discord.MessageButton().setCustomId('addcboton').setLabel("Cupom").setStyle("PRIMARY").setDisabled(disabled),
                            new Discord.MessageButton().setCustomId('comprarboton').setLabel("Pagar PIX").setStyle("SUCCESS").setDisabled(disabled),
                            new Discord.MessageButton().setCustomId('addboton').setLabel('+1').setStyle("SECONDARY").setDisabled(disabled),
                            new Discord.MessageButton().setCustomId('removeboton').setLabel('-1').setStyle("SECONDARY").setDisabled(disabled),
                            new Discord.MessageButton().setCustomId('cancelar').setLabel("Cancelar").setStyle("DANGER").setDisabled(disabled)
                        );
                    };

                    const updateEmbed = () => {
                        return new Discord.MessageEmbed()
                            .setTitle(`Resumo do Pedido`)
                            .setDescription(`🛒 **Produto:** ${eprod.nome}\n📦 **Quantidade:** ${quantidadeCompra}\n💸 **Total:** R$${precoAtual.toFixed(2)}\n🎫 **Cupom:** ${cupomAplicado || 'Nenhum'}`)
                            .setColor(botConfigCache.cor || '#000000');
                    };

                    const painelMsg = await c.send({ embeds: [updateEmbed()], components: [createControlRow()] });
                    const painelCollector = painelMsg.createMessageComponentCollector({ filter: i => i.user.id === interaction.user.id });

                    painelCollector.on("collect", async iPanel => {
                        
                        // --- LÓGICA DE AUMENTAR/DIMINUIR QUANTIDADE ---
                        if (iPanel.customId === 'addboton') {
                            if (quantidadeCompra + 1 > eprod.conta.length) {
                                return iPanel.reply({ content: "Estoque insuficiente para adicionar mais.", ephemeral: true });
                            }
                            quantidadeCompra++;
                            precoAtual += eprod.preco; // Recalcula preço base
                            // (Nota: Se tiver cupom, teria que reaplicar a lógica do desconto aqui, simplificado para o exemplo)
                            iPanel.update({ embeds: [updateEmbed()] });
                        }

                        if (iPanel.customId === 'removeboton') {
                            if (quantidadeCompra > 1) {
                                quantidadeCompra--;
                                precoAtual -= eprod.preco;
                                iPanel.update({ embeds: [updateEmbed()] });
                            } else {
                                iPanel.deferUpdate();
                            }
                        }

                        if (iPanel.customId === 'cancelar') {
                             c.delete().catch(() => {});
                        }

                        // --- LÓGICA DO CUPOM ---
                        if (iPanel.customId === 'addcboton') {
                            iPanel.deferUpdate();
                            c.permissionOverwrites.edit(interaction.user.id, { SEND_MESSAGES: true });
                            const askMsg = await c.send("Digite o código do cupom:");
                            
                            const filterMsg = m => m.author.id === interaction.user.id;
                            const collected = await c.awaitMessages({ filter: filterMsg, max: 1, time: 30000 });
                            
                            if (collected.size === 0) {
                                c.permissionOverwrites.edit(interaction.user.id, { SEND_MESSAGES: false });
                                return askMsg.edit("Tempo esgotado.");
                            }

                            const code = collected.first().content;
                            collected.first().delete().catch(()=>{});
                            askMsg.delete().catch(()=>{});

                            const cupomData = await Coupon.findOne({ idcupom: code });

                            if (!cupomData || cupomData.quantidade <= 0) {
                                c.send("Cupom inválido ou esgotado.").then(m => setTimeout(() => m.delete(), 3000));
                            } else if (precoAtual < cupomData.minimo) {
                                c.send(`Valor mínimo para este cupom é R$${cupomData.minimo}`).then(m => setTimeout(() => m.delete(), 3000));
                            } else {
                                // Aplicar desconto (assumindo porcentagem no exemplo original "0.desc")
                                // Ajuste conforme sua lógica real de cupom
                                const descontoValor = precoAtual * (cupomData.desconto / 100); 
                                precoAtual = precoAtual - descontoValor;
                                cupomAplicado = code;
                                
                                await Coupon.updateOne({ idcupom: code }, { $inc: { quantidade: -1 } });
                                
                                c.send("Cupom aplicado!").then(m => setTimeout(() => m.delete(), 3000));
                                painelMsg.edit({ embeds: [updateEmbed()], components: [createControlRow(false)] });
                            }
                            c.permissionOverwrites.edit(interaction.user.id, { SEND_MESSAGES: false });
                        }

                        // --- LÓGICA DE PAGAMENTO (MERCADO PAGO) ---
                        if (iPanel.customId === 'comprarboton') {
                            iPanel.deferUpdate();
                            painelMsg.delete().catch(()=>{});
                            
                            // Configurar MP com token do banco ou ENV
                            const mpToken = botConfigCache.acesstoken || process.env.MP_ACCESS_TOKEN;
                            mercadopago.configurations.setAccessToken(mpToken);

                            const payment_data = {
                                transaction_amount: Number(precoAtual.toFixed(2)),
                                description: `Pagamento - ${interaction.user.username} - ${eprod.nome}`,
                                payment_method_id: 'pix',
                                payer: {
                                    email: 'cliente@discord.com', // Email genérico obrigatório
                                    first_name: interaction.user.username,
                                    last_name: 'Discord',
                                    identification: { type: 'CPF', number: '00000000000' } // CPF Genérico
                                }
                            };

                            mercadopago.payment.create(payment_data).then(async (data) => {
                                const buffer = Buffer.from(data.body.point_of_interaction.transaction_data.qr_code_base64, "base64");
                                const attachment = new Discord.MessageAttachment(buffer, "payment.png");
                                const pixCode = data.body.point_of_interaction.transaction_data.qr_code;

                                const rowPay = new Discord.MessageActionRow()
                                    .addComponents(
                                        new Discord.MessageButton().setCustomId('copiaecola').setLabel("Copia e Cola").setStyle("PRIMARY").setEmoji("💠"),
                                        new Discord.MessageButton().setCustomId('cancelarpix').setLabel("Cancelar").setStyle("DANGER")
                                    );

                                const embedPay = new Discord.MessageEmbed()
                                    .setTitle("Pagamento PIX Gerado")
                                    .setDescription(`Valor: **R$${precoAtual.toFixed(2)}**\nProduto: **${eprod.nome}**\n\nEscaneie o QR Code ou clique em Copia e Cola.`)
                                    .setImage("attachment://payment.png")
                                    .setColor(botConfigCache.cor || '#000000');

                                const msgPay = await c.send({ embeds: [embedPay], files: [attachment], components: [rowPay] });

                                // Loop de verificação de pagamento
                                const checkPaymentLoop = setInterval(async () => {
                                    try {
                                        const res = await axios.get(`https://api.mercadolibre.com/v1/payments/${data.body.id}`, {
                                            headers: { 'Authorization': `Bearer ${mpToken}` }
                                        });

                                        if (res.data.status === "approved") {
                                            clearInterval(checkPaymentLoop);
                                            
                                            // --- PAGAMENTO APROVADO ---
                                            // 1. Verificar estoque novamente (Race condition)
                                            const produtoFinal = await Product.findOne({ id: eprod.id });
                                            if (produtoFinal.conta.length < quantidadeCompra) {
                                                c.send("Pagamento aprovado, mas o estoque acabou neste meio tempo! Contate o suporte com ID: " + data.body.id);
                                                // Implementar lógica de reembolso ou log de erro
                                                return;
                                            }

                                            // 2. Remover itens do estoque e salvar
                                            // Retira os primeiros 'n' itens
                                            const entregues = produtoFinal.conta.slice(0, quantidadeCompra);
                                            // Remove esses itens do array no banco
                                            await Product.updateOne(
                                                { id: eprod.id }, 
                                                { $pull: { conta: { $in: entregues } } }
                                            );

                                            // 3. Entregar no DM
                                            const embedEntrega = new Discord.MessageEmbed()
                                                .setTitle("Pagamento Aprovado! 📦")
                                                .setDescription(`Aqui está seu produto:\n\`\`\`${entregues.join("\n")}\`\`\``)
                                                .setColor("GREEN");
                                            
                                            interaction.user.send({ embeds: [embedEntrega] }).catch(e => c.send("Não consegui enviar na DM, salve agora: \n" + entregues.join("\n")));

                                            // 4. Logs e Stats
                                            c.send("✅ Pagamento aprovado e produto entregue na DM! O carrinho fechará em 10s.");
                                            
                                            // Atualizar stats do usuário (exemplo simplificado)
                                            // await Stats.updateOne({ userId: interaction.user.id }, { $inc: { gastos: precoAtual, pedidos: 1 } }, { upsert: true });

                                            // Logs
                                            if (botConfigCache.logs) {
                                                const logChannel = client.channels.cache.get(botConfigCache.logs);
                                                if (logChannel) logChannel.send(`Venda Aprovada! User: ${interaction.user.tag} | Valor: ${precoAtual}`);
                                            }
                                            
                                            // Adicionar cargo
                                            if (botConfigCache.cargo) {
                                                const role = interaction.guild.roles.cache.get(botConfigCache.cargo);
                                                if (role) interaction.member.roles.add(role).catch(()=>{});
                                            }

                                            setTimeout(() => c.delete().catch(()=>{}), 10000);
                                        }
                                    } catch (err) {
                                        console.log("Erro ao verificar pagamento", err.message);
                                    }
                                }, 5000); // Checa a cada 5 segundos

                                // Collector para o botão copia e cola
                                const collectorPay = msgPay.createMessageComponentCollector({ componentType: 'BUTTON', time: 600000 });
                                collectorPay.on('collect', iPay => {
                                    if (iPay.customId === 'copiaecola') {
                                        iPay.reply({ content: pixCode, ephemeral: true });
                                    }
                                    if (iPay.customId === 'cancelarpix') {
                                        clearInterval(checkPaymentLoop);
                                        c.delete().catch(()=>{});
                                    }
                                });
                            }).catch(err => {
                                console.log(err);
                                c.send("Erro ao gerar PIX. Tente novamente.");
                            });
                        }
                    });
                }
            });
        });
    }
});

