const { Product } = require("../models.js"); // Importe o modelo que criamos

module.exports = {
    run: async (client, message, args) => {
        // Verifica permissão (exemplo)
        if (!message.member.permissions.has("ADMINISTRATOR")) return message.reply("Sem permissão.");

        const idProduto = args[0]; // ID do botão/produto
        const novoPreco = parseFloat(args[1]?.replace(',', '.')); // Aceita 10,50 ou 10.50

        if (!idProduto || isNaN(novoPreco)) {
            return message.reply("Uso correto: `/setpreco <id_produto> <valor>`");
        }

        // Tenta atualizar. O primeiro objeto é o FILTRO (quem buscar), o segundo é a AÇÃO.
        const resultado = await Product.updateOne(
            { id: idProduto }, 
            { $set: { preco: novoPreco } }
        );

        if (resultado.matchedCount === 0) {
            return message.reply("❌ Produto não encontrado com esse ID.");
        }

        message.reply(`✅ O preço do produto **${idProduto}** foi alterado para **R$${novoPreco.toFixed(2)}**.`);
    }
}
