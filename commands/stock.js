const { Product } = require("../models.js");

module.exports = {
    run: async (client, message, args) => {
        const idProduto = args[0];
        
        // Busca o produto
        const produto = await Product.findOne({ id: idProduto });

        if (!produto) return message.reply("❌ Produto não encontrado.");

        const quantidade = produto.conta.length;
        
        // Cuidado para não mostrar o conteúdo do estoque em chat público se for sensível!
        // Aqui mostramos apenas a quantidade:
        message.reply(`📦 O produto **${produto.nome}** tem **${quantidade}** itens em estoque.`);
        
        // Se quiser ver os itens (envie na DM para segurança):
        // message.author.send(`Itens: \n${produto.conta.join("\n")}`);
    }
}
