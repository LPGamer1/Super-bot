const mongoose = require('mongoose');

// Modelo para os Produtos (substitui o quick.db dos produtos)
const ProductSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true }, // ID do botão/produto
    nome: String,
    preco: Number,
    desc: String,
    conta: [String] // Array com o estoque (ex: contas, chaves)
});

// Modelo para Configurações do Bot (substitui myJsonBotConfig.json)
const ConfigSchema = new mongoose.Schema({
    guildId: String, // ID do servidor para identificar a config
    nomebot: String,
    cor: String,
    banner: String,
    bannerentrega: String,
    canaltermos: String,
    catecarrinho: String,
    logs: String,
    logspublica: String,
    cargo: String, // Cargo de cliente
    acesstoken: String // Token do Mercado Pago
});

// Modelo para Cupons (substitui myJsonCupons.json)
const CouponSchema = new mongoose.Schema({
    idcupom: String,
    desconto: Number, // Porcentagem ou valor
    minimo: Number,
    quantidade: Number
});

// Modelo para Estatísticas/Financeiro (substitui myJsonDatabase.json)
const StatsSchema = new mongoose.Schema({
    userId: String, // ID do usuário ou 'global' para status geral
    pedidos: { type: Number, default: 0 },
    gastos: { type: Number, default: 0 },
    // Para o controle diário, usamos Map
    dailyStats: { type: Map, of: Object } 
});

module.exports = {
    Product: mongoose.model('Product', ProductSchema),
    Config: mongoose.model('Config', ConfigSchema),
    Coupon: mongoose.model('Coupon', CouponSchema),
    Stats: mongoose.model('Stats', StatsSchema)
};
