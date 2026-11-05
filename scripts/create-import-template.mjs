import ExcelJS from "exceljs";

const workbook = new ExcelJS.Workbook();
workbook.creator = "Portal Devplan";
workbook.created = new Date();
workbook.modified = new Date();
workbook.subject = "Modelo para importação em lote de demandas";
workbook.title = "Modelo de importação de demandas";

const fields = [
  ["Título *", "titulo", 38],
  ["Descrição", "descricao", 42],
  ["Produto *", "produto", 24],
  ["Responsável", "responsavel", 24],
  ["Categoria *", "categoria", 20],
  ["Origem", "origem", 18],
  ["Número do artefato", "artefato", 21],
  ["Link do artefato", "link", 36],
  ["Solicitante", "solicitante", 24],
  ["Impacto", "impacto", 16],
  ["Esforço", "nivelEsforco", 16],
  ["Status", "status", 24],
  ["Quarter desejado", "quarter", 20],
  ["Data de início", "inicio", 17],
  ["Data de término", "termino", 17],
  ["Prazo desejado", "prazo", 18],
  ["Esforço Estimado (Horas) *", "esforcoEstimadoHoras", 25],
  ["Faturamento", "faturamento", 16],
  ["Valor faturado (R$)", "valor", 21],
  ["Observação", "observacao", 40],
];

const sheet = workbook.addWorksheet("Demandas", {
  views: [{ state: "frozen", ySplit: 1, xSplit: 2 }],
});
sheet.columns = fields.map(([header, key, width]) => ({ header, key, width }));
sheet.properties.defaultRowHeight = 21;
sheet.getRow(1).height = 34;
sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17365D" } };
sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center", wrapText: true };
sheet.autoFilter = { from: "A1", to: `T1` };
sheet.getColumn("inicio").numFmt = "dd/mm/yyyy";
sheet.getColumn("termino").numFmt = "dd/mm/yyyy";
sheet.getColumn("prazo").numFmt = "dd/mm/yyyy";
sheet.getColumn("esforcoEstimadoHoras").numFmt = "0.0";
sheet.getColumn("valor").numFmt = 'R$ #,##0.00';
sheet.getColumn("link").font = { color: { argb: "FF0563C1" }, underline: true };

const lists = {
  categoria: '"Estratégica,Evolutiva,Bug,Incidente,Sustentação,Regulatória,Técnica,Emergencial"',
  origem: '"Produto,Cliente,Tecnologia,Regulatório,Operações"',
  impacto: '"Baixo,Médio,Alto"',
  nivelEsforco: '"Alto,Médio,Baixo"',
  status: '"Não Iniciado,Backlog,Planejado,Em análise,Em Estudos,Em Desenvolvimento,Concluído,Cancelado,Bloqueado"',
  faturamento: '"Sim,Não"',
};
const year = Math.max(2026, new Date().getFullYear());
const quarterCount = Math.max(8, (year - 2026 + 2) * 4);
const quarters = Array.from({ length: quarterCount }, (_, index) => `Q${index % 4 + 1} ${2026 + Math.floor(index / 4)}`);
const options = workbook.addWorksheet("Opções");
options.state = "veryHidden";
options.getCell("A1").value = "Planejamento";
quarters.forEach((quarter, index) => { options.getCell(index + 2, 1).value = quarter; });
const columnByKey = Object.fromEntries(fields.map(([, key], index) => [key, index + 1]));
for (let row = 2; row <= 1001; row += 1) {
  for (const [key, formula] of Object.entries(lists)) {
    sheet.getCell(row, columnByKey[key]).dataValidation = {
      type: "list", allowBlank: true, formulae: [formula], showErrorMessage: true,
      errorTitle: "Valor fora da lista", error: "Escolha uma das opções disponíveis.",
    };
  }
  sheet.getCell(row, columnByKey.quarter).dataValidation = {
    type: "list", allowBlank: true, formulae: [`INDIRECT("'Opções'!$A$1:$A$${quarters.length + 1}")`],
    showErrorMessage: true, errorTitle: "Quarter inválido", error: "Escolha um quarter da lista.",
  };
  for (const key of ["esforcoEstimadoHoras", "valor"]) {
    sheet.getCell(row, columnByKey[key]).dataValidation = {
      type: "decimal", operator: "greaterThanOrEqual", allowBlank: true, formulae: [0],
      showErrorMessage: true, errorTitle: "Número inválido", error: "Informe um número igual ou maior que zero.",
    };
  }
  for (const key of ["inicio", "termino", "prazo"]) {
    sheet.getCell(row, columnByKey[key]).dataValidation = {
      type: "date", operator: "between", allowBlank: true,
      formulae: [new Date(2000, 0, 1), new Date(2100, 11, 31)],
      showErrorMessage: true, errorTitle: "Data inválida", error: "Informe uma data válida.",
    };
  }
}
for (let row = 2; row <= 1001; row += 1) {
  if (row % 2 === 0) {
    sheet.getRow(row).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F7FB" } };
  }
}

const instructions = workbook.addWorksheet("Instruções", { views: [{ state: "frozen", ySplit: 1 }] });
instructions.columns = [
  { header: "Campo", key: "campo", width: 31 },
  { header: "Obrigatório", key: "obrigatorio", width: 17 },
  { header: "Como preencher", key: "orientacao", width: 100 },
];
instructions.addRows([
  ["Como importar", "", "Preencha uma demanda por linha na aba Demandas. Importe este arquivo pelo botão Importar Excel na visão Gestão de Demanda."],
  ["Título", "Sim", "Nome da demanda. Não deixe vazio."],
  ["Produto", "Sim", "Use o nome exato de um produto ativo já cadastrado no portal. Produtos inexistentes ou inativos fazem a linha ser ignorada."],
  ["Categoria", "Sim", "Escolha uma opção da lista. Campo obrigatório no cadastro do portal."],
  ["Impacto", "Não", "Escolha Baixo, Médio ou Alto."],
  ["Esforço", "Não", "Escolha Alto, Médio ou Baixo."],
  ["Esforço Estimado (Horas)", "Sim", "Número maior que zero. Aceita casas decimais; pode usar vírgula ou ponto."],
  ["Responsável", "Não", "Se ficar vazio, o portal usa o primeiro nome do coordenador cadastrado no produto."],
  ["Quarter desejado", "Não", "Planejamento mantém a demanda sem quarter no roadmap. Um quarter Qn AAAA adiciona a demanda ao período correspondente."],
  ["Datas", "Não", "Use uma data real no Excel ou DD/MM/AAAA ou AAAA-MM-DD. Data de término deve ser igual ou posterior à data de início."],
  ["Prazo desejado", "Não", "Prazo solicitado para a demanda; independente da data de término planejada."],
  ["Link do artefato", "Não", "Informe um endereço iniciado por https:// ou http://."],
  ["Faturamento", "Não", "Escolha Sim ou Não. O valor faturado é considerado quando Faturamento estiver como Sim."],
  ["ID da demanda", "Automático", "Não crie nem preencha IDs. O portal gera um identificador único para cada linha importada."],
  ["Campos opcionais", "Não", "Descrição, solicitante, origem, impacto, esforço qualitativo, status, artefato e observação podem ficar em branco."],
  ["Compatibilidade", "", "Não altere os nomes da primeira linha. A importação lê a primeira aba e os cabeçalhos deste modelo."],
]);
instructions.getRow(1).height = 28;
instructions.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
instructions.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17365D" } };
instructions.getRow(1).alignment = { vertical: "middle" };
instructions.getColumn("orientacao").alignment = { wrapText: true, vertical: "top" };
instructions.getColumn("campo").font = { bold: true, color: { argb: "FF17365D" } };
instructions.getRow(2).height = 42;
for (let row = 2; row <= instructions.rowCount; row += 1) instructions.getRow(row).height = 34;
instructions.autoFilter = { from: "A1", to: `C${instructions.rowCount}` };

await workbook.xlsx.writeFile("modelo-importacao-demandas-atualizado.xlsx");
