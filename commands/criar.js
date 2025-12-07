const Discord = require("discord.js");
const { Product } = require("../models.js"); // Importa o modelo

module.exports = {
    name: "criar",
    aliases: ["create"],
    run: async (client, message, args) => {
        // Verifica permissão (ajuste conforme seu sistema de permissão antigo)
        if (!message.member.permissions.has("ADMINISTRATOR")) return message.reply("❌ Sem permissão.");

        const id = args[0];
        const preco = args[1];
        // Pega o nome (tudo depois do preço)
        const nome = args.slice(2).join(" "); 

        if (!id || !preco || !nome) {
            return message.reply("❌ Uso correto: `/criar <id_sem_espaço> <preço> <nome do produto>`");
        }

        // Verifica se já existe
        const existe = await Product.findOne({ id: id });
        if (existe) return message.reply("❌ Já existe um produto com esse ID!");

        // Cria no MongoDB
        const novoProduto = new Product({
            id: id,
            nome: nome,
            preco: parseFloat(preco.replace(',', '.')), // Garante formato numérico
            desc: "Use /setdesc para alterar a descrição",
            conta: [] // Estoque vazio inicialmente
        });

        await novoProduto.save();

        message.reply(`✅ Produto **${nome}** (ID: \`${id}\`) criado com sucesso! Preço: R$${preco}`);
    }
}
