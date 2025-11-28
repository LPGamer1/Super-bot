require('dotenv').config();
const express = require('express');
const axios = require('axios');
const moment = require('moment');
// IMPORTANTE: Adicionamos a OpenAI aqui
const OpenAI = require('openai');

const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    PermissionsBitField, ChannelType, ApplicationCommandOptionType 
} = require('discord.js');

// --- CONFIGURAÇÕES ---
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID; 
const REDIRECT_TARGET = 'https://discord.com/app'; 

// --- INICIALIZAÇÃO DA IA ---
// Se não tiver a chave no .env, o bot avisa no console mas liga.
let openai;
if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log("✅ OpenAI configurada.");
} else {
    console.log("⚠️ OPENAI_API_KEY não encontrada. O comando /quiz ia não funcionará.");
}

// --- INICIALIZAÇÃO DO BOT ---
const app = express();
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// MEMÓRIA VOLÁTIL
const userTokens = new Map(); 
const sorteiosAtivos = new Map(); 
const activeQuizzes = new Map(); 

// =================================================================
// SISTEMA WEB (AUTH PREMIUM) - Mantido igual
// =================================================================
app.get('/', (req, res) => res.send('💎 Super Bot Ultimate + IA Online'));
// ... (O resto do código do app.get('/callback') permanece idêntico ao anterior, omiti para economizar espaço, mas MANTENHA ELE AQUI) ...
app.get('/callback', async (req, res) => {
    const { code, state } = req.query; 
    if (!code) return res.send('Erro: Falta código.');
    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({ client_id: process.env.CLIENT_ID, client_secret: process.env.CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: process.env.REDIRECT_URI, scope: 'identify guilds.join', }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const { access_token } = tokenResponse.data;
        const userResponse = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${access_token}` }, });
        const user = userResponse.data;
        userTokens.set(user.id, access_token);
        let statusCargo = "⏭️ Ignorado (Sem State)"; let nomeServidor = "Desconhecido";
        if (state) { try { const guild = client.guilds.cache.get(state); if (guild) { nomeServidor = guild.name; const member = await guild.members.fetch(user.id).catch(() => null); const role = guild.roles.cache.find(r => r.name === 'Auth2 Vetificados'); if (member && role) { await member.roles.add(role); statusCargo = `✅ Entregue em: ${guild.name}`; } else { statusCargo = `❌ Falha: Cargo não existe em ${guild.name}`; } } } catch (e) { console.error(e); } }
        const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) { const embed = new EmbedBuilder().setTitle('🌍 Nova Verificação').setThumbnail(`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`).addFields({ name: 'Usuário', value: `${user.username}\n(${user.id})`, inline: true }, { name: 'Origem', value: nomeServidor, inline: true }, { name: 'Cargo', value: statusCargo, inline: false }).setColor(0x00FF00); const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`btn_abrir_envio_${user.id}`).setLabel('Enviar Usuário').setStyle(ButtonStyle.Primary).setEmoji('✈️')); logChannel.send({ embeds: [embed], components: [row] }); }
        res.send(`<!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Acesso Liberado</title><style>:root{--blurple:#5865F2;--dark:#2b2d31}body{background-color:var(--dark);font-family:'Segoe UI',sans-serif;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;overflow:hidden}.card{background:rgba(30,31,34,0.8);backdrop-filter:blur(10px);padding:40px;border-radius:15px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);animation:popIn 0.6s cubic-bezier(0.68,-0.55,0.27,1.55)}.icon{font-size:60px;margin-bottom:20px;animation:pulse 2s infinite}h1{margin:0 0 10px;font-size:28px}p{color:#b5bac1;margin-bottom:30px}.btn{background:var(--blurple);color:#fff;padding:12px 30px;text-decoration:none;border-radius:5px;font-weight:bold;transition:0.3s}.btn:hover{box-shadow:0 0 15px var(--blurple)}@keyframes popIn{from{opacity:0;transform:scale(0.8)}to{opacity:1;transform:scale(1)}}@keyframes pulse{0%{transform:scale(1)}50%{transform:scale(1.1)}100%{transform:scale(1)}}</style></head><body><div class="card"><div class="icon">💎</div><h1>Acesso VIP Liberado</h1><p>Verificação concluída no servidor <b>${nomeServidor}</b>.<br>Seus privilégios foram ativados.</p><a href="${REDIRECT_TARGET}" class="btn">Voltar ao Servidor</a><div style="margin-top:20px;font-size:12px;color:#777">Redirecionando em 3s...</div></div><script>setTimeout(()=>{window.location.href="${REDIRECT_TARGET}"},3000)</script></body></html>`);
    } catch (e) { res.send('Erro na verificação.'); }
});
app.listen(process.env.PORT || 3000);

// =================================================================
// BOT DISCORD
// =================================================================
client.once('ready', async () => {
    console.log(`🤖 Ultimate Bot + IA Logado: ${client.user.tag}`);

    const commands = [
        { name: 'painel_auth', description: 'Cria o painel de verificação' },
        { name: 'painel_ticket', description: 'Cria o painel de suporte avançado' },
        { name: 'sorteio', description: 'Inicia um sorteio', options: [{ name: 'premio', description: 'Prêmio', type: 3, required: true }, { name: 'minutos', description: 'Duração', type: 4, required: true }] },
        { name: 'ship', description: 'Calcula o amor', options: [{ name: 'usuario1', description: 'Pessoa 1', type: 6, required: true }, { name: 'usuario2', description: 'Pessoa 2', type: 6, required: true }] },
        
        // --- NOVO COMANDO QUIZ (COM SUBCOMANDOS) ---
        {
            name: 'quiz',
            description: 'Inicia um quiz valendo ponto',
            options: [
                {
                    name: 'manual',
                    description: 'Crie sua própria pergunta e resposta',
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        { name: 'pergunta', description: 'Qual a pergunta?', type: 3, required: true },
                        { name: 'resposta', description: 'Qual a resposta exata?', type: 3, required: true }
                    ]
                },
                {
                    name: 'ia',
                    description: 'A IA gera uma pergunta para você',
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        { name: 'tema', description: 'Tema opcional (ex: jogos, história, roblox)', type: 3, required: false }
                    ]
                }
            ]
        }
        // ------------------------------------------
    ];

    await client.application.commands.set(commands);
    console.log("✅ Comandos Globais atualizados com IA!");
});

// --- LISTENER DO QUIZ (Verifica respostas no chat) ---
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (activeQuizzes.has(message.channel.id)) {
        const respostaCerta = activeQuizzes.get(message.channel.id);
        // Verifica se a mensagem contém a resposta certa (ignorando maiúsculas/minúsculas)
        if (message.content.toLowerCase().includes(respostaCerta.toLowerCase())) {
            message.reply(`🏆 **PARABÉNS!** ${message.author} acertou! A resposta era: **${respostaCerta}**.`);
            activeQuizzes.delete(message.channel.id);
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        // --- COMANDO QUIZ ATUALIZADO ---
        if (commandName === 'quiz') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) 
                return interaction.reply({content:'Apenas Moderadores.', ephemeral:true});
            
            if (activeQuizzes.has(interaction.channel.id)) 
                return interaction.reply({content: 'Já tem um quiz rolando aqui!', ephemeral:true});

            const subcommand = interaction.options.getSubcommand();

            // >>> OPÇÃO 1: MANUAL <<<
            if (subcommand === 'manual') {
                const pergunta = interaction.options.getString('pergunta');
                const resposta = interaction.options.getString('resposta');
                iniciarQuiz(interaction, pergunta, resposta);
            }

            // >>> OPÇÃO 2: IA (Inteligência Artificial) <<<
            if (subcommand === 'ia') {
                if (!openai) return interaction.reply({ content: '❌ A IA não está configurada (Falta OPENAI_API_KEY no Render).', ephemeral: true });

                await interaction.deferReply(); // IA demora um pouco, avisamos o Discord
                const tema = interaction.options.getString('tema') || 'conhecimentos gerais';

                try {
                    // Pedimos para a IA gerar a pergunta
                    const completion = await openai.chat.completions.create({
                        model: "gpt-3.5-turbo", // Ou gpt-4o-mini se preferir
                        messages: [
                            { role: "system", content: "Você é um gerador de quiz. Gere uma pergunta interessante e desafiadora e sua resposta curta e exata." },
                            { role: "user", content: `Gere uma pergunta sobre o tema: "${tema}". Retorne APENAS um JSON no formato: {"pergunta": "...", "resposta": "..."}` }
                        ],
                        temperature: 0.7,
                    });

                    // Processamos a resposta da IA
                    const conteudo = completion.choices[0].message.content;
                    // Tentamos ler o JSON que a IA mandou
                    let dadosIA;
                    try {
                        dadosIA = JSON.parse(conteudo);
                    } catch (e) {
                        // Se a IA falhar em mandar JSON limpo, tentamos limpar
                        const jsonLimpo = conteudo.replace(/```json\n|\n```/g, '');
                        dadosIA = JSON.parse(jsonLimpo);
                    }

                    if (!dadosIA.pergunta || !dadosIA.resposta) throw new Error("Formato inválido da IA");

                    // Inicia o quiz com os dados da IA
                    // Usamos editReply porque deferimos antes
                    const embed = new EmbedBuilder()
                        .setTitle(`🧠 QUIZ IA: ${tema.toUpperCase()}`)
                        .setDescription(`**Pergunta:** ${dadosIA.pergunta}\n\n*Responda no chat para ganhar!*`)
                        .setColor('Aqua')
                        .setFooter({text: 'Gerado por Inteligência Artificial'});

                    await interaction.editReply({ embeds: [embed] });
                    activeQuizzes.set(interaction.channel.id, dadosIA.resposta);
                    console.log(`Quiz IA iniciado. Resposta: ${dadosIA.resposta}`);

                } catch (erro) {
                    console.error("Erro OpenAI:", erro);
                    interaction.editReply({ content: '❌ A IA teve um piripaque e não conseguiu gerar a pergunta. Tente novamente.' });
                }
            }
        }

        // Outros comandos (painel_auth, ticket, sorteio, ship) continuam aqui...
        // (Vou omitir para não ficar gigante, mas MANTENHA O CÓDIGO DELES AQUI)
        // ... [Códigos dos outros comandos]
        if (commandName === 'painel_auth') { if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return; const authUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify+guilds.join&state=${interaction.guild.id}`; const embed = new EmbedBuilder().setTitle('🛡️ Verificação Segura').setDescription('Se verifique para poder ter acesso a itens exclusivos no servidor, como: Chat premium, Scripts Vazados (E em beta), e muitas outras coisas!').setColor(0x5865F2).setFooter({ text: 'Sistema seguro de Verificação' }); const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Verificar Agora').setStyle(ButtonStyle.Link).setURL(authUrl).setEmoji('✅')); await interaction.channel.send({ embeds: [embed], components: [row] }); interaction.reply({ content: 'Painel Auth enviado.', ephemeral: true }); }
        if (commandName === 'painel_ticket') { if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return; const embed = new EmbedBuilder().setTitle('🎫 Central de Suporte').setDescription('Selecione abaixo a categoria do seu problema para iniciar o atendimento.').setColor('Gold'); const menu = new StringSelectMenuBuilder().setCustomId('menu_ticket_criar').setPlaceholder('Selecione a Categoria').addOptions(new StringSelectMenuOptionBuilder().setLabel('Suporte / Dúvidas').setValue('Sup').setEmoji('❓'), new StringSelectMenuOptionBuilder().setLabel('Comprar Scripts').setValue('Vendas').setEmoji('💎'), new StringSelectMenuOptionBuilder().setLabel('Reportar Bug').setValue('Bug').setEmoji('🐛')); await interaction.channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] }); interaction.reply({ content: 'Painel Ticket enviado.', ephemeral: true }); }
        if (commandName === 'ship') { const user1 = interaction.options.getUser('usuario1'); const user2 = interaction.options.getUser('usuario2'); const porcentagem = Math.floor(Math.random() * 101); const totalBarras = 10; const barrasPreenchidas = Math.round((porcentagem / 100) * totalBarras); const barra = '🟩'.repeat(barrasPreenchidas) + '⬛'.repeat(totalBarras - barrasPreenchidas); let frase = ""; if(porcentagem < 20) frase = "💀 Sem chance..."; else if(porcentagem < 50) frase = "🤔 Talvez na friendzone?"; else if(porcentagem < 90) frase = "❤️ Casal lindo!"; else frase = "💍 CASAMENTO JÁ!"; const embed = new EmbedBuilder().setTitle('💘 Máquina do Amor').setDescription(`**${user1}** ❤️ **${user2}**\n\n**${porcentagem}%**\n${barra}\n\n${frase}`).setColor(porcentagem > 50 ? 'Red' : 'Grey'); interaction.reply({ embeds: [embed] }); }
        if (commandName === 'sorteio') { const premio = interaction.options.getString('premio'); const minutos = interaction.options.getInteger('minutos'); const tempoMs = minutos * 60 * 1000; const fimTimestamp = Math.floor((Date.now() + tempoMs) / 1000); const embed = new EmbedBuilder().setTitle('🎉 SORTEIO RELÂMPAGO').setDescription(`**Prêmio:** ${premio}\n**Termina às:** <t:${fimTimestamp}:t> (<t:${fimTimestamp}:R>)`).setColor(0xF4D03F); const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('entrar_sorteio').setLabel('Participar (0)').setStyle(ButtonStyle.Success).setEmoji('🎉')); const msg = await interaction.reply({ embeds: [embed], components: [btn], fetchReply: true }); sorteiosAtivos.set(msg.id, { participantes: new Set(), premio }); setTimeout(async () => { const dados = sorteiosAtivos.get(msg.id); if(!dados) return; const lista = Array.from(dados.participantes); let txt = "Sorteio cancelado (ninguém entrou)."; if(lista.length > 0) { const ganhador = lista[Math.floor(Math.random() * lista.length)]; txt = `👑 Parabéns <@${ganhador}>! Você ganhou **${dados.premio}**!`; msg.channel.send(txt).catch(()=>{}); } const embedFim = new EmbedBuilder().setTitle('🎉 SORTEIO ENCERRADO').setDescription(txt).setColor('Red'); msg.edit({ embeds: [embedFim], components: [] }).catch(()=>{}); }, tempoMs); }
    }

    // MANTENHA AQUI TODA A LÓGICA DE BOTÕES E MODALS (Ticket, Auth Enviar, Sorteio)
    // (Omitido para economizar espaço, mas é essencial que fique aqui)
    if (interaction.isStringSelectMenu() && interaction.customId === 'menu_ticket_criar') { const categoria = interaction.values[0]; const modal = new ModalBuilder().setCustomId(`modal_ticket_${categoria}`).setTitle('Detalhes do Ticket'); const input = new TextInputBuilder().setCustomId('motivo').setLabel('Descreva seu pedido/problema').setStyle(TextInputStyle.Paragraph); modal.addComponents(new ActionRowBuilder().addComponents(input)); interaction.showModal(modal); }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_ticket_')) { const categoria = interaction.customId.split('_')[2]; const motivo = interaction.fields.getTextInputValue('motivo'); const canal = await interaction.guild.channels.create({ name: `${categoria}-${interaction.user.username}`, type: ChannelType.GuildText, topic: interaction.user.id, permissionOverwrites: [ { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }, { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] } ] }); const embed = new EmbedBuilder().setTitle(`Ticket: ${categoria}`).setDescription(`**Usuário:** ${interaction.user}\n**Motivo:** ${motivo}\n\nAguarde a equipe.`).setColor('Green'); const row = new ActionRowBuilder().addComponents( new ButtonBuilder().setCustomId('fechar_ticket').setLabel('Encerrar').setStyle(ButtonStyle.Danger).setEmoji('🔒') ); canal.send({ content: `${interaction.user}`, embeds: [embed], components: [row] }); interaction.reply({ content: `✅ Ticket criado: ${canal}`, ephemeral: true }); }
    if (interaction.isButton() && interaction.customId === 'fechar_ticket') { interaction.reply('🔒 O ticket será deletado em 5 segundos...'); setTimeout(() => interaction.channel.delete(), 5000); }
    if (interaction.isButton() && interaction.customId.startsWith('btn_abrir_envio_')) { const uid = interaction.customId.split('_')[3]; const modal = new ModalBuilder().setCustomId(`modal_envio_${uid}`).setTitle('Enviar Usuário'); const input = new TextInputBuilder().setCustomId('srv_id').setLabel('ID do Servidor Alvo').setStyle(TextInputStyle.Short); modal.addComponents(new ActionRowBuilder().addComponents(input)); interaction.showModal(modal); }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_envio_')) { const uid = interaction.customId.split('_')[2]; const srvId = interaction.fields.getTextInputValue('srv_id'); const token = userTokens.get(uid); await interaction.deferReply({ ephemeral: true }); if (!token) return interaction.editReply('❌ Token expirou.'); try { await axios.put( `https://discord.com/api/guilds/${srvId}/members/${uid}`, { access_token: token }, { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } } ); interaction.editReply(`✅ Usuário enviado com sucesso para \`${srvId}\``); } catch (e) { interaction.editReply('❌ Erro. O bot está no servidor alvo?'); } }
    if (interaction.isButton() && interaction.customId === 'entrar_sorteio') { const dados = sorteiosAtivos.get(interaction.message.id); if(!dados) return interaction.reply({content:'Acabou.', ephemeral:true}); if(dados.participantes.has(interaction.user.id)) { dados.participantes.delete(interaction.user.id); interaction.reply({content:'Saiu.', ephemeral:true}); } else { dados.participantes.add(interaction.user.id); interaction.reply({content:'Entrou!', ephemeral:true}); } const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('entrar_sorteio').setLabel(`Participar (${dados.participantes.size})`).setStyle(ButtonStyle.Success).setEmoji('🎉')); interaction.message.edit({ components: [btn] }); }

});

// Função auxiliar para quiz manual
function iniciarQuiz(interaction, pergunta, resposta) {
    activeQuizzes.set(interaction.channel.id, resposta);
    const embed = new EmbedBuilder()
        .setTitle('🧠 QUIZ MANUAL')
        .setDescription(`**Pergunta:** ${pergunta}\n\n*Responda no chat para ganhar!*`)
        .setColor('Purple')
        .setFooter({text: `Iniciado por ${interaction.user.username}`});
    interaction.reply({ embeds: [embed] });
}

client.login(process.env.BOT_TOKEN);
