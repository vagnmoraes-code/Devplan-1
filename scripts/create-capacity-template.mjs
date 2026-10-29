import ExcelJS from "exceljs";

const workbook = new ExcelJS.Workbook();
workbook.creator = "Roadmap Portal";
const sheet = workbook.addWorksheet("Capacidade", { views: [{ state: "frozen", ySplit: 1 }] });
sheet.columns = [
  { header: "Colaborador", key: "name", width: 30 },
  { header: "Função", key: "role", width: 22 },
  { header: "Produto", key: "product", width: 20 },
  { header: "Capacidade total", key: "total", width: 20 },
  { header: "Horas alocadas", key: "used", width: 20 },
];
const header = sheet.getRow(1);
header.height = 28;
header.font = { bold: true, color: { argb: "FFFFFFFF" } };
header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF246BFD" } };
header.alignment = { vertical: "middle", horizontal: "center" };
sheet.autoFilter = { from: "A1", to: "E1" };

const instructions = workbook.addWorksheet("Instruções");
instructions.columns = [{ header: "Campo", width: 24 }, { header: "Obrigatório", width: 15 }, { header: "Orientação", width: 75 }];
instructions.addRows([
  ["Colaborador", "Sim", "Nome completo. Se já existir, sua capacidade será atualizada."],
  ["Função", "Não", "Função exercida pelo colaborador."],
  ["Produto", "Sim", "Deve existir e estar ativo no cadastro de Produtos."],
  ["Capacidade total", "Sim", "Horas disponíveis no período, somente números."],
  ["Horas alocadas", "Não", "Alocação base; demandas vinculadas serão adicionadas automaticamente."],
]);
const ih = instructions.getRow(1);
ih.font = { bold: true, color: { argb: "FFFFFFFF" } };
ih.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF172D5B" } };
await workbook.xlsx.writeFile("modelo-importacao-capacidade.xlsx");
