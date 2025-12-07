const Discord = require("discord.js");
const { Coupon } = require("../models.js");

module.exports = {
    run: async (client, message, args) => {
        if (!message.member.permissions.has("ADMINISTRATOR")) return;

        const codigo = args[0];
        const desconto = parseInt(args[1]); // Ex: 10 (para 10%)
        const minimo = parseInt(args[2]); // Valor mínimo da compra
        const quantidade = parseInt(args[3]); // Quantas vezes pode usar

        if (!codigo || !desconto || !minimo || !quantidade) {
            return message.reply("❌ Uso: `/criarcupom <código> <desconto%> <valor_minimo> <quantidade>`");
        }

        await Coupon.create({
            idcupom: codigo,
            desconto: desconto,
            minimo: minimo,
            quantidade: quantidade
        });

        message.reply(`✅ Cupom **${codigo}** criado! Desconto: ${desconto}% | Mínimo: R$${minimo} | Qtd: ${quantidade}`);
    }
}
