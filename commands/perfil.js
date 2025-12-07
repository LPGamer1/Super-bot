const Discord = require("discord.js");
const { Stats } = require("../models.js");

module.exports = {
    run: async (client, message, args) => {
        const user = message.mentions.users.first() || message.author;
        
        // Busca stats ou cria um zerado se não existir (upsert logic manual)
        let data = await Stats.findOne({ userId: user.id });
        if (!data) {
            data = { pedidos: 0, gastos: 0 }; // Dados falsos temporários só pra exibir
        }

        const embed = new Discord.MessageEmbed()
            .setTitle(`Perfil de ${user.username}`)
            .addField("📦 Pedidos Feitos", `${data.pedidos}`, true)
            .addField("💸 Total Gasto", `R$${data.gastos.toFixed(2)}`, true)
            .setColor("BLUE")
            .setThumbnail(user.displayAvatarURL());

        message.reply({ embeds: [embed] });
    }
}
