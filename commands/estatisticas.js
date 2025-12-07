const Discord = require("discord.js");
const { Product, Stats } = require("../models.js");

module.exports = {
    run: async (client, message, args) => {
        // Conta quantos produtos existem
        const totalProdutos = await Product.countDocuments({});
        
        // Soma todos os gastos de todos os usuários (Agregação do Mongo)
        const financeiro = await Stats.aggregate([
            { $group: { _id: null, totalVendido: { $sum: "$gastos" }, totalPedidos: { $sum: "$pedidos" } } }
        ]);

        const totalReais = financeiro[0]?.totalVendido || 0;
        const totalPed = financeiro[0]?.totalPedidos || 0;

        const embed = new Discord.MessageEmbed()
            .setTitle("📊 Estatísticas da Loja")
            .addField("📦 Produtos Cadastrados", `${totalProdutos}`, true)
            .addField("💰 Total Vendido", `R$ ${totalReais.toFixed(2)}`, true)
            .addField("🛒 Total de Pedidos", `${totalPed}`, true)
            .setColor("GREEN");

        message.reply({ embeds: [embed] });
    }
}
