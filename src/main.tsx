import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import ExcelJS from "exceljs";
import * as I from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./styles.css";
import "./dashboard.css";
import "./capacity.css";
import "./changes.css";
import "./demands.css";
import capacitySeed from "./capacity-seed.json";
import { ADMIN_EMAIL, Account, AccessRole, hashPassword, loadAccounts, makeAccount, saveAccounts, sessionId, setSession } from "./auth";

function usePersistentState<T>(key: string, initialValue: T | (() => T)) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) return JSON.parse(saved) as T;
    } catch {
      // Mantém os dados iniciais caso o armazenamento esteja indisponível/corrompido.
    }
    return typeof initialValue === "function"
      ? (initialValue as () => T)()
      : initialValue;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // A aplicação continua funcional mesmo sem acesso ao armazenamento local.
    }
  }, [key, value]);

  return [value, setValue] as const;
}

type Page =
  | "Visão geral"
  | "Roadmap"
  | "Comparação"
  | "Demandas"
  | "Produtos"
  | "Capacidade"
  | "Planejamento"
  | "Auditoria"
  | "Relatórios"
  | "Analytics"
  | "Configurações"
  | "Usuários";
type Demand = {
  id: string;
  name: string;
  product: string;
  owner: string;
  status: string;
  priority: string;
  effort: number;
  actualEffort?: number;
  billable?: boolean;
  billedAmount?: number;
  progress: number;
  due: string;
  risk: string;
  type?: string;
  version?: string;
  notes?: string;
  startDate?: string;
  dueDate?: string;
  resourceIds?: number[];
};
type ChangeLog={id:number;date:string;title:string;actor:string;detail:string;tone:"blue"|"good"|"warn"|"bad";product?:string;quarter?:string;demandId?:string;demandName?:string};
type Product = {
  id: number;
  name: string;
  code: string;
  description: string;
  team: string;
  coordinator: string;
  active: boolean;
};
const ProductAccessContext = createContext<Set<number> | null>(null);
function scopedSetter<T>(setValue: React.Dispatch<React.SetStateAction<T[]>>, isVisible: (item: T) => boolean): React.Dispatch<React.SetStateAction<T[]>> {
  return update => setValue(current => {
    const visible = current.filter(isVisible);
    const next = typeof update === "function" ? (update as (items: T[]) => T[])(visible) : update;
    return [...current.filter(item => !isVisible(item)), ...next];
  });
}
function useAllowedProductNames() {
  const allowedIds = useContext(ProductAccessContext);
  const catalog = useContext(ProductContext);
  return allowedIds === null ? null : new Set((catalog?.products || []).filter(product => allowedIds.has(product.id)).map(product => product.name));
}
const initialProducts: Product[] = [
  { id: 1, name: "nddMove", code: "MOVE", description: "", team: "Squad nddMove", coordinator: "Marina Costa", active: true },
  { id: 2, name: "nddCargo", code: "CARGO", description: "", team: "Squad nddCargo", coordinator: "Rafael Lima", active: true },
  { id: 3, name: "nddElog", code: "ELOG", description: "", team: "Squad nddElog", coordinator: "Camila Souza", active: true },
  { id: 4, name: "nddFrete", code: "FRETE", description: "", team: "Squad nddFrete", coordinator: "Bruno Alves", active: true },
  { id: 5, name: "CIOT FÁCIL", code: "CIOT", description: "", team: "Squad CIOT FÁCIL", coordinator: "Bianca Melo", active: true },
];
const legacyProductNames: Record<string,string> = { Commerce: "nddMove", Payments: "nddCargo", Customer: "nddElog", Platform: "nddFrete", Analytics: "CIOT FÁCIL" };
function migrateProducts() {
  try {
    if (localStorage.getItem("dev-plan:products-v2")) return;
    // Atualiza referências do conjunto demonstrativo antigo sem apagar demandas ou capacidade.
    for (const key of ["dev-plan:demands", "dev-plan:team", "dev-plan:history", "dev-plan:roadmap-versions"]) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const value = JSON.parse(raw);
      const replace = (item:unknown):unknown => {
        if (Array.isArray(item)) return item.map(replace);
        if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([field,content]) => [field, field === "product" && typeof content === "string" ? legacyProductNames[content] ?? content : replace(content)]));
        return item;
      };
      localStorage.setItem(key, JSON.stringify(replace(value)));
    }
    localStorage.setItem("dev-plan:products", JSON.stringify(initialProducts));
    localStorage.setItem("dev-plan:products-v2", "1");
  } catch { /* Mantém os dados locais quando o armazenamento não estiver disponível. */ }
}
migrateProducts();
const ProductContext = createContext<{
  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
} | null>(null);
function ProductProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = usePersistentState<Product[]>("dev-plan:products", initialProducts);
  return (
    <ProductContext.Provider value={{ products, setProducts }}>
      {children}
    </ProductContext.Provider>
  );
}
function useProducts() {
  const value = useContext(ProductContext);
  if (!value) throw new Error("ProductProvider ausente");
  const allowedIds = useContext(ProductAccessContext);
  if (allowedIds === null) return value;
  return { products: value.products.filter(product => allowedIds.has(product.id)), setProducts: scopedSetter(value.setProducts, product => allowedIds.has(product.id)) };
}
type RoadmapEntry = {
  demandId: string;
  quarter: string;
  collaborators: string[];
  allocations: { staffId: number; hours: number }[];
};
type RoadmapVersion = {
  id: number;
  version: number;
  quarter: string;
  createdAt: string;
  entries: RoadmapEntry[];
  demands: Demand[];
};
const demands: Demand[] = [
  ...[
    "[OXXO] Integrar filiais do SAP para Frete",
    "Gerenciamento de transmissões",
    "Sincronização de ocorrência parametrizáveis (Move)",
    "Tratar performance e telas lentas",
    "Analisar componentes que impedem seleção",
    "Atualizar componentes NDS",
  ].map((name, index) => ({
    id: `DEV-${160 + index}`,
    name,
    product: "nddFrete",
    owner: "",
    status: "Backlog",
    priority: "Média",
    effort: 0,
    progress: 0,
    due: "Sem prazo",
    risk: "Baixo",
    resourceIds: [],
  })),
  ...[
    "Unificar Move x Elog - Migração de Mapas para OpenStreetMap",
    "Projeto GEQ: Alertas",
    "Projeto GEQ: Gestão de Custos extras",
    "Projeto GEQ: Sequenciamento no APP",
    "Onde está minha entrega? - visão cliente final",
    "Dashboards direto no portal ( BI Move > Elog)",
    "Projeto GEQ: Motorista -  Disponibilizar-se para carregamento",
  ].map((name, index) => ({
    id: `DEV-${166 + index}`,
    name,
    product: "nddMove",
    owner: "",
    status: "Backlog",
    priority: "Média",
    effort: 0,
    progress: 0,
    due: "Sem prazo",
    risk: "Baixo",
    resourceIds: [],
  })),
];
function replaceRegisteredDemands() {
  try {
    if (localStorage.getItem("dev-plan:demands-v2")) return;
    localStorage.setItem("dev-plan:demands", JSON.stringify(demands));
    localStorage.setItem("dev-plan:roadmap", "[]");
    localStorage.setItem("dev-plan:history", "[]");
    localStorage.setItem("dev-plan:roadmap-versions", "[]");
    localStorage.setItem("dev-plan:demands-v2", "1");
  } catch { /* A lista inicial continua disponível sem armazenamento local. */ }
}
replaceRegisteredDemands();
function addMoveDemandsToStoredData() {
  try {
    if (localStorage.getItem("dev-plan:move-demands-v1")) return;
    const stored = JSON.parse(localStorage.getItem("dev-plan:demands") || "[]");
    const rows: Demand[] = Array.isArray(stored) ? stored : [];
    const moveDemands = demands.filter(demand => demand.product === "nddMove");
    const missing = moveDemands.filter(demand => !rows.some(row => row.product === demand.product && row.name === demand.name));
    const usedIds = new Set(rows.map(row => row.id));
    const next = missing.map(demand => {
      let id = demand.id;
      let number = 173;
      while (usedIds.has(id)) id = `DEV-${number++}`;
      usedIds.add(id);
      return { ...demand, id };
    });
    localStorage.setItem("dev-plan:demands", JSON.stringify([...rows, ...next]));
    localStorage.setItem("dev-plan:move-demands-v1", "1");
  } catch { /* Os dados iniciais continuam disponíveis sem armazenamento local. */ }
}
addMoveDemandsToStoredData();
const DemandContext = createContext<{
  rows: Demand[];
  setRows: React.Dispatch<React.SetStateAction<Demand[]>>;
  roadmap: RoadmapEntry[];
  setRoadmap: React.Dispatch<React.SetStateAction<RoadmapEntry[]>>;
  history: ChangeLog[];
  setHistory: React.Dispatch<React.SetStateAction<ChangeLog[]>>;
  versions: RoadmapVersion[];
  setVersions: React.Dispatch<React.SetStateAction<RoadmapVersion[]>>;
} | null>(null);
function DemandProvider({ children }: { children: React.ReactNode }) {
  const [rows, setRows] = usePersistentState<Demand[]>("dev-plan:demands", demands);
  const [roadmap, setRoadmap] = usePersistentState<RoadmapEntry[]>(
    "dev-plan:roadmap",
    [],
  );
  const [history,setHistory]=usePersistentState<ChangeLog[]>("dev-plan:history", []);
  const [versions,setVersions]=usePersistentState<RoadmapVersion[]>("dev-plan:roadmap-versions", []);
  return (
    <DemandContext.Provider value={{ rows, setRows, roadmap, setRoadmap, history, setHistory, versions, setVersions }}>
      {children}
    </DemandContext.Provider>
  );
}
function useDemands() {
  const value = useContext(DemandContext);
  if (!value) throw new Error("DemandProvider ausente");
  const allowedNames = useAllowedProductNames();
  if (allowedNames === null) return value;
  const canSeeDemand = (demand: Demand) => allowedNames.has(demand.product);
  const visibleIds = new Set(value.rows.filter(canSeeDemand).map(demand => demand.id));
  const canSeeEntry = (entry: RoadmapEntry) => visibleIds.has(entry.demandId);
  const canSeeHistory = (entry: ChangeLog) => Boolean(entry.product && allowedNames.has(entry.product));
  const canSeeVersion = (version: RoadmapVersion) => version.demands.some(canSeeDemand);
  return {
    rows: value.rows.filter(canSeeDemand), setRows: scopedSetter(value.setRows, canSeeDemand),
    roadmap: value.roadmap.filter(canSeeEntry), setRoadmap: scopedSetter(value.setRoadmap, canSeeEntry),
    history: value.history.filter(canSeeHistory), setHistory: scopedSetter(value.setHistory, canSeeHistory),
    versions: value.versions.filter(canSeeVersion).map(version => ({ ...version, demands: version.demands.filter(canSeeDemand), entries: version.entries.filter(canSeeEntry) })),
    setVersions: scopedSetter(value.setVersions, canSeeVersion),
  };
}
const nav: [Page, any][] = [
  ["Visão geral", I.LayoutDashboard],
  ["Demandas", I.ListTodo],
  ["Roadmap", I.Map],
  ["Comparação", I.GitCompareArrows],
  ["Produtos", I.Boxes],
  ["Capacidade", I.Users],
  ["Planejamento", I.CalendarRange],
  ["Auditoria", I.ClipboardCheck],
  ["Relatórios", I.BarChart3],
  ["Analytics", I.ChartNoAxesCombined],
  ["Configurações", I.Settings],
  ["Usuários", I.UserCog],
];
const trend = [
  { w: "S1", plan: 22, done: 18 },
  { w: "S2", plan: 34, done: 28 },
  { w: "S3", plan: 48, done: 42 },
  { w: "S4", plan: 62, done: 56 },
  { w: "S5", plan: 76, done: 66 },
  { w: "S6", plan: 88, done: 78 },
];
const C = {
  blue: "#246bfd",
  cyan: "#38bdf8",
  green: "#16a36a",
  amber: "#f59e0b",
  red: "#ef4444",
  purple: "#8b5cf6",
};

function Badge({
  children,
  tone = "blue",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={"badge " + tone}>{children}</span>;
}
function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={"card " + className}>{children}</section>;
}
function PageHead({
  title,
  desc,
  action,
}: {
  title: string;
  desc: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="pagehead">
      <div>
        <div className="eyebrow">Q3 2026 · PLANEJAMENTO ATIVO</div>
        <h1>{title}</h1>
        <p>{desc}</p>
      </div>
      {action}
    </div>
  );
}
function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="charttip">
      <b>{label}</b>
      {payload.map((p: any) => (
        <div key={p.name}>
          <i style={{ background: p.color }} /> {p.name}: <b>{p.value}h</b>
        </div>
      ))}
    </div>
  );
}

function Dashboard({ go }: { go: (p: Page) => void }) {
  const { rows, roadmap } = useDemands();
  const { products } = useProducts();
  const { team } = useTeam();
  const [productFilter, setProductFilter] = useState("Todos");
  const scoped = productFilter === "Todos" ? rows : rows.filter((d) => d.product === productFilter);
  const scopedIds = new Set(scoped.map((d) => d.id));
  const planned = roadmap.filter((item) => scopedIds.has(item.demandId));
  const effort = scoped.reduce((sum, demand) => sum + demand.effort, 0);
  const scopedTeam = productFilter === "Todos" ? team : team.filter((person) => person.product === productFilter);
  const totalCapacity = scopedTeam.reduce((sum, person) => sum + person.total, 0);
  const demandHoursFor = (staffId: number) => rows.reduce((total, demand) => {
    const plan = roadmap.find((item) => item.demandId === demand.id);
    const explicit = plan?.allocations.find((item) => item.staffId === staffId);
    const linkedIds = demand.resourceIds || [];
    if (!explicit && !linkedIds.includes(staffId)) return total;
    const explicitTotal = (plan?.allocations || []).reduce((sum, item) => sum + item.hours, 0);
    const resourcesWithoutAdjustment = linkedIds.filter(
      (id) => !plan?.allocations.some((item) => item.staffId === id),
    );
    const calculated = resourcesWithoutAdjustment.length
      ? Math.round(Math.max(0, demand.effort - explicitTotal) / resourcesWithoutAdjustment.length)
      : 0;
    return total + (explicit?.hours ?? calculated);
  }, 0);
  const allocatedCapacity = scopedTeam.reduce(
    (sum, person) => sum + demandHoursFor(person.id),
    0,
  );
  const roadmapCapacity = scopedTeam.reduce((sum, person) => sum + demandHoursFor(person.id), 0);
  const baseCapacity = 0;
  const availableCapacity = Math.max(0, totalCapacity - allocatedCapacity);
  const utilization = totalCapacity ? Math.round((allocatedCapacity / totalCapacity) * 100) : 0;
  const capacityByProduct=products.filter((product)=>product.active&&(productFilter==="Todos"||product.name===productFilter)).map((product)=>{const people=team.filter((person)=>person.product===product.name);const total=people.reduce((sum,person)=>sum+person.total,0);const allocated=people.reduce((sum,person)=>sum+demandHoursFor(person.id),0);return {product:product.name,total,allocated,available:total-allocated,utilization:total?Math.round(allocated/total*100):0}});
  const capacityChart = ["Jul", "Ago", "Set"].map((m) => {
    const monthlyTotal = Math.round(totalCapacity / 3);
    const roadmapHours = Math.round(roadmapCapacity / 3);
    const sustentacao = Math.round(baseCapacity / 3);
    return { m, roadmap: roadmapHours, sustentacao, novas: 0, reserva: Math.max(0, monthlyTotal - roadmapHours - sustentacao) };
  });
  const completed = scoped.filter((d) => ["Concluído", "Concluída"].includes(d.status)).length;
  const developmentTeam = scopedTeam.filter(person => ["DEV", "BACKEND", "FRONTEND", "FULL STACK"].includes(person.role.trim().toUpperCase()));
  const testingTeam = scopedTeam.filter(person => ["QA", "QA ENGINEER"].includes(person.role.trim().toUpperCase()));
  const coordinationTeam = scopedTeam.filter(person => person.role.trim().toUpperCase() === "COORDENADOR");
  const specialistTeam = scopedTeam.filter(person => ["ESPECIALISTA", "ESPECIALISTA DEV 1"].includes(person.role.trim().toUpperCase()));
  const developmentCapacity = developmentTeam.reduce((sum, person) => sum + person.total, 0);
  const testingCapacity = testingTeam.reduce((sum, person) => sum + person.total, 0);
  const coordinationCapacity = coordinationTeam.reduce((sum, person) => sum + person.total, 0);
  const specialistCapacity = specialistTeam.reduce((sum, person) => sum + person.total, 0);
  const progress = scoped.length ? Math.round(scoped.reduce((sum, d) => sum + d.progress, 0) / scoped.length) : 0;
  const kpis = [
    ["Capacidade total", `${totalCapacity}h`, `${utilization}% alocada · ${scopedTeam.length} colaboradores`, utilization > 90 ? "bad" : "blue", I.Users],
    ["Capacidade estimada", `${effort}h`, `${scoped.length} demandas`, "warn", I.Gauge],
    ["Roadmap planejado", String(planned.length), `${completed} concluídas`, "blue", I.Map],
    ["Progresso médio", `${progress}%`, "no escopo atual", "good", I.Crosshair],
  ];
  return (
    <>
      <PageHead
        title="Visão geral do roadmap"
        desc="Acompanhe capacidade, progresso e decisões críticas do trimestre."
        action={
          <button className="primary" onClick={() => go("Planejamento")}>
            <I.Sparkles /> Simular mudança
          </button>
        }
      />
      <div className="dashboard-filter"><div><I.Filter/><span><b>Escopo dos indicadores</b><small>Visualize o consolidado ou um produto específico</small></span></div><select value={productFilter} onChange={(e) => setProductFilter(e.target.value)}><option>Todos</option>{products.filter((p)=>p.active).map((p)=><option key={p.id} value={p.name}>{p.name}</option>)}</select></div>
      <div className="kpis dashboard-kpis">
        {kpis.map(([n, v, d, t, Icon]: any) => (
          <Card key={n} className="kpi">
            <div className={"kicon " + t}>
              <Icon />
            </div>
            <div className="klabel">
              {n}
              <I.Info />
            </div>
            <strong>{v}</strong>
            <small className={t}>
              {t === "bad" ? "↑" : "↗"} {d} <span>vs. Q2</span>
            </small>
          </Card>
        ))}
      </div>
      <Card className="discipline-capacity-card"><div className="cardhead"><div><h3>Capacidade por disciplina</h3><p>Horas cadastradas para o escopo selecionado</p></div></div><div className="discipline-capacity-grid"><div><span><I.Code2/> Capacidade de Desenvolvimento</span><strong>{developmentCapacity}h</strong><small>{developmentTeam.length} colaboradores DEV</small></div><div><span><I.FlaskConical/> Capacidade de Testes</span><strong>{testingCapacity}h</strong><small>{testingTeam.length} colaboradores QA</small></div><div><span><I.UsersRound/> Capacidade de Coordenação</span><strong>{coordinationCapacity}h</strong><small>{coordinationTeam.length} coordenador(es)</small></div><div><span><I.Braces/> Capacidade de Especialista DEV 1</span><strong>{specialistCapacity}h</strong><small>{specialistTeam.length} especialista(s)</small></div></div></Card>
      <Card className="product-capacity-card"><div className="cardhead"><div><h3>Capacidade por produto</h3><p>Capacidade cadastrada, alocada e disponível por produto</p></div><Badge tone="gray">{capacityByProduct.length} produto(s)</Badge></div><div className="product-capacity-grid">{capacityByProduct.map((item)=><div className="product-capacity-item" key={item.product}><div><span className="product-mini-icon"><I.Boxes/></span><div><b>{item.product}</b><small>{item.available}h disponíveis</small></div><strong className={item.utilization>90?"bad":""}>{item.utilization}%</strong></div><div className="product-capacity-bar"><i className={item.utilization>90?"over":""} style={{width:Math.min(item.utilization,100)+"%"}}/></div><footer><span>Total <b>{item.total}h</b></span><span>Alocada <b>{item.allocated}h</b></span></footer></div>)}</div></Card>
      <div className="grid2">
        <Card>
          <div className="cardhead">
            <div>
              <h3>Capacidade por categoria</h3>
              <p>Distribuição mensal do trimestre</p>
            </div>
            <button className="icon">
              <I.MoreHorizontal />
            </button>
          </div>
          <div className="chart">
            <ResponsiveContainer>
              <BarChart data={capacityChart} barGap={0}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="m" />
                <YAxis />
                <Tooltip content={<ChartTip />} />
                <Bar
                  dataKey="roadmap"
                  name="Roadmap"
                  stackId="a"
                  fill={C.blue}
                />
                <Bar
                  dataKey="sustentacao"
                  name="Sustentação"
                  stackId="a"
                  fill={C.cyan}
                />
                <Bar
                  dataKey="novas"
                  name="Novas demandas"
                  stackId="a"
                  fill={C.amber}
                />
                <Bar
                  dataKey="reserva"
                  name="Reserva"
                  stackId="a"
                  fill="#dbe5f4"
                  radius={[5, 5, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="legend">
            <span>
              <i className="b" />
              Roadmap {totalCapacity ? Math.round(roadmapCapacity / totalCapacity * 100) : 0}%
            </span>
            <span>
              <i className="c" />
              Sustentação {totalCapacity ? Math.round(baseCapacity / totalCapacity * 100) : 0}%
            </span>
            <span>
              <i className="a" />
              Novas 0%
            </span>
            <span>
              <i />
              Reserva {totalCapacity ? Math.round(availableCapacity / totalCapacity * 100) : 0}%
            </span>
          </div>
        </Card>
        <Card>
          <div className="cardhead">
            <div>
              <h3>Progresso do roadmap</h3>
              <p>Planejado vs. realizado</p>
            </div>
            <Badge tone="good">+6,4%</Badge>
          </div>
          <div className="chart">
            <ResponsiveContainer>
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop stopColor={C.blue} stopOpacity=".22" />
                    <stop offset="1" stopColor={C.blue} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="w" />
                <YAxis />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="plan"
                  stroke="#a9b5c7"
                  fill="transparent"
                  strokeDasharray="4 4"
                />
                <Area
                  type="monotone"
                  dataKey="done"
                  stroke={C.blue}
                  fill="url(#g)"
                  strokeWidth={3}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="progressfoot">
            <b>14 de 18 demandas no prazo</b>
            <span>78% concluído ou em curso</span>
          </div>
        </Card>
      </div>
      <div className="grid3">
        <Card className="span2">
          <div className="cardhead">
            <div>
              <h3>Demandas que exigem atenção</h3>
              <p>Priorizadas por risco e proximidade do prazo</p>
            </div>
            <button className="ghost" onClick={() => go("Demandas")}>
              Ver todas <I.ArrowRight />
            </button>
          </div>
          <DemandTable compact />
        </Card>
        <Card>
          <div className="cardhead">
            <div>
              <h3>Saúde do trimestre</h3>
              <p>Visão consolidada</p>
            </div>
          </div>
          <div className="donut">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={[{ v: 78 }, { v: 22 }]}
                  dataKey="v"
                  innerRadius={62}
                  outerRadius={78}
                  startAngle={90}
                  endAngle={-270}
                >
                  <Cell fill={C.green} />
                  <Cell fill="#e9eef5" />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div>
              <strong>78</strong>
              <span>/100</span>
              <small>SAUDÁVEL</small>
            </div>
          </div>
          <div className="health">
            <p>
              <span>
                <i className="good" />
                Prazo
              </span>
              <b>82%</b>
            </p>
            <p>
              <span>
                <i className="warn" />
                Capacidade
              </span>
              <b>91%</b>
            </p>
            <p>
              <span>
                <i className="bad" />
                Risco
              </span>
              <b>3 críticos</b>
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}

function ExecutiveView() {
  const { rows } = useDemands();
  const { products } = useProducts();
  const [product, setProduct] = useState("Todos");
  const [weekOffset, setWeekOffset] = useState(0);
  const base = new Date();
  const day = base.getDay() || 7;
  const monday = new Date(base.getFullYear(), base.getMonth(), base.getDate() - day + 1 + weekOffset * 7);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  const start = iso(monday), end = iso(sunday);
  const scoped = product === "Todos" ? rows : rows.filter((demand) => demand.product === product);
  const isDone = (demand: Demand) => demand.progress === 100 || ["Concluído", "Concluída"].includes(demand.status);
  const delivered = scoped.filter(isDone);
  const overlapsWeek = (demand: Demand) => Boolean(demand.startDate && demand.dueDate && demand.startDate <= end && demand.dueDate >= start);
  const planned = scoped.filter((demand) => !isDone(demand) && overlapsWeek(demand) && (demand.progress === 0 || ["Backlog", "Planejada"].includes(demand.status)));
  const plannedIds = new Set(planned.map((demand) => demand.id));
  const executing = scoped.filter((demand) => !isDone(demand) && overlapsWeek(demand) && !plannedIds.has(demand.id));
  const format = (date: Date) => date.toLocaleDateString("pt-BR", {day:"2-digit",month:"short"}).replace(".","");
  const DemandExecutiveCard = ({ demand }: { demand: Demand }) => <div className="executive-demand"><div><b>{demand.name}</b><small>{demand.id} · {demand.product}</small></div><div><span>{demand.progress}%</span><div className="mini"><i style={{width:`${demand.progress}%`}}/></div></div><footer><span><I.CalendarDays/>{demand.startDate ? new Date(demand.startDate+"T12:00:00").toLocaleDateString("pt-BR") : "Sem início"} — {demand.dueDate ? new Date(demand.dueDate+"T12:00:00").toLocaleDateString("pt-BR") : "Sem prazo"}</span><Badge tone={demand.status.includes("Bloqueada")?"bad":"blue"}>{demand.status}</Badge></footer></div>;
  return <><PageHead title="Visão executiva" desc="Acompanhe entregas e compromissos semanais do time."/>
    <div className="executive-controls"><div><I.CalendarRange/><span><b>Semana acompanhada</b><small>{format(monday)} a {format(sunday)}</small></span></div><div className="week-navigation"><button onClick={()=>setWeekOffset((value)=>value-1)} title="Semana anterior"><I.ChevronLeft/></button><button onClick={()=>setWeekOffset(0)}>Semana atual</button><button onClick={()=>setWeekOffset((value)=>value+1)} title="Próxima semana"><I.ChevronRight/></button></div><label><I.Boxes/><span>Produto</span><select value={product} onChange={(e)=>setProduct(e.target.value)}><option value="Todos">Todos os produtos</option>{products.filter((item)=>item.active).map((item)=><option key={item.id}>{item.name}</option>)}</select></label></div>
    <div className="kpis compact"><Card><span>Entregues</span><strong>{delivered.length}</strong><small>em todo o histórico</small></Card><Card><span>Em execução</span><strong>{executing.length}</strong><small>na semana selecionada</small></Card><Card><span>Planejadas</span><strong>{planned.length}</strong><small>na semana selecionada</small></Card><Card><span>Esforço semanal</span><strong>{[...executing,...planned].reduce((sum,demand)=>sum+demand.effort,0)}h</strong><small>{product==="Todos"?"todos os produtos":product}</small></Card></div>
    <div className="executive-week-grid"><Card><div className="cardhead"><div><h3>Em execução na semana</h3><p>Demandas ativas entre {format(monday)} e {format(sunday)}</p></div><Badge tone="blue">{executing.length}</Badge></div><div className="executive-list">{executing.length?executing.map((demand)=><DemandExecutiveCard key={demand.id} demand={demand}/>):<div className="executive-empty"><I.CalendarX/><span>Nenhuma demanda em execução nesta semana.</span></div>}</div></Card><Card><div className="cardhead"><div><h3>Planejadas para a semana</h3><p>Demandas ainda não iniciadas no período</p></div><Badge tone="gray">{planned.length}</Badge></div><div className="executive-list">{planned.length?planned.map((demand)=><DemandExecutiveCard key={demand.id} demand={demand}/>):<div className="executive-empty"><I.CalendarX/><span>Nenhuma demanda planejada nesta semana.</span></div>}</div></Card></div>
    <Card><div className="cardhead"><div><h3>Demandas entregues</h3><p>Todas as entregas concluídas {product==="Todos"?"":"do produto "+product}</p></div><Badge tone="good">{delivered.length} entregues</Badge></div>{delivered.length?<DemandTableRows rows={delivered}/>:<div className="executive-empty"><I.CircleCheck/><span>Nenhuma demanda entregue neste escopo.</span></div>}</Card>
  </>;
}

function DemandTable({ compact = false }: { compact?: boolean }) {
  const rows = compact ? demands.slice(0, 4) : demands;
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Demanda</th>
            <th>Produto</th>
            <th>Responsável</th>
            <th>Status</th>
            <th>Prioridade</th>
            <th>Esforço</th>
            <th>Prazo</th>
            <th>Risco</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td>
                <b>{d.name}</b>
                <small>{d.id}</small>
              </td>
              <td>{d.product}</td>
              <td>
                <span className="person">{d.owner[0]}</span>
                {d.owner}
              </td>
              <td>
                <Badge
                  tone={
                    ["Concluído", "Concluída"].includes(d.status)
                      ? "good"
                      : d.status === "Bloqueada"
                        ? "bad"
                        : "blue"
                  }
                >
                  {d.status}
                </Badge>
              </td>
              <td>
                <span className={"priority " + d.priority.toLowerCase()}>
                  <i />
                  {d.priority}
                </span>
              </td>
              <td>{d.effort}h</td>
              <td>{d.due}</td>
              <td>
                <Badge
                  tone={
                    d.risk === "Crítico"
                      ? "bad"
                      : d.risk === "Alto"
                        ? "warn"
                        : d.risk === "Baixo"
                          ? "good"
                          : "gray"
                  }
                >
                  {d.risk}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const quarterMonths: Record<string, string[]> = {
  Q1: ["JANEIRO", "FEVEREIRO", "MARÇO"],
  Q2: ["ABRIL", "MAIO", "JUNHO"],
  Q3: ["JULHO", "AGOSTO", "SETEMBRO"],
  Q4: ["OUTUBRO", "NOVEMBRO", "DEZEMBRO"],
};
const quarters = [
  "Q1 2026",
  "Q2 2026",
  "Q3 2026",
  "Q4 2026",
  "Q1 2027",
  "Q2 2027",
  "Q3 2027",
  "Q4 2027",
];

function Roadmap() {
  const { rows, roadmap, setRoadmap, setHistory, versions, setVersions } = useDemands();
  const { team } = useTeam();
  const { products } = useProducts();
  const [view, setView] = useState("Timeline");
  const [quarter, setQuarter] = useState("Q3 2026");
  const [productFilter, setProductFilter] = useState("Todos");
  const [picker, setPicker] = useState(false);
  const [pickerProduct, setPickerProduct] = useState("");
  const [staffFor, setStaffFor] = useState<RoadmapEntry | null>(null);
  const items = roadmap.flatMap((entry) => {
    const demand = rows.find((d) => d.id === entry.demandId);
    return entry.quarter === quarter && demand && (productFilter === "Todos" || demand.product === productFilter) ? [{ demand, entry }] : [];
  });
  const available = rows.filter(
    (d) => !roadmap.some((r) => r.demandId === d.id),
  );
  const availableForProduct = available.filter(demand => demand.product === pickerProduct);
  const pickerProducts = Array.from(new Set([...products.filter(product => product.active).map(product => product.name), ...available.map(demand => demand.product)]));
  const openPicker = () => { setPickerProduct(productFilter === "Todos" ? "" : productFilter); setPicker(true); };
  const months = quarterMonths[quarter.slice(0, 2)];
  const register=(title:string,detail:string,tone:ChangeLog["tone"]="blue",eventQuarter?:string)=>{const demandId=detail.match(/DEV-\d+/)?.[0];const demand=rows.find((d)=>d.id===demandId);setHistory((current)=>[{id:Date.now(),date:new Date().toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}),title,actor:"Vagner Moraes",detail,tone,product:demand?.product,quarter:eventQuarter,demandId,demandName:demand?.name},...current])};
  const createVersion = () => {
    const entries = roadmap.filter((entry) => entry.quarter === quarter);
    const demandIds = new Set(entries.map((entry) => entry.demandId));
    const version = Math.max(0, ...versions.map((item) => item.version)) + 1;
    setVersions((current) => [...current, {
      id: Date.now(), version, quarter,
      createdAt: new Date().toLocaleString("pt-BR"),
      entries: structuredClone(entries),
      demands: structuredClone(rows.filter((demand) => demandIds.has(demand.id))),
    }]);
    setHistory((current) => [{id:Date.now(),date:new Date().toLocaleString("pt-BR"),title:`Versão V${version} do Roadmap criada`,actor:"Vagner Moraes",detail:`Snapshot de ${entries.length} demanda(s) preservado para ${quarter}`,tone:"good",quarter},...current]);
  };
  const add = (id: string) => {
    if (roadmap.some(item => item.demandId === id)) return;
    setRoadmap((current) => current.some(item => item.demandId === id) ? current : [
      ...current,
      { demandId: id, quarter, collaborators: [], allocations: [] },
    ]);
    register("Demanda adicionada ao roadmap",`${id} planejada em ${quarter}`,"good",quarter);
  };
  const move = (id: string, destination: string) => {
    const origin=roadmap.find((item)=>item.demandId===id)?.quarter;
    setRoadmap((current) =>
      current.map((r) =>
        r.demandId === id ? { ...r, quarter: destination } : r,
      ),
    );
    register("Demanda movida de quarter",`${id}: ${origin} → ${destination}`,"warn",destination);
  };
  const remove = (id: string) => {const origin=roadmap.find((item)=>item.demandId===id)?.quarter;setRoadmap((current) => current.filter((r) => r.demandId !== id));register("Demanda removida do roadmap",`${id} removida do planejamento`,"bad",origin)};
  const updateAllocation = (person: Staff, hours: number) => {
    if (!staffFor) return;
    const allocations = hours > 0
      ? [...staffFor.allocations.filter((a) => a.staffId !== person.id), { staffId: person.id, hours }]
      : staffFor.allocations.filter((a) => a.staffId !== person.id);
    const collaborators = allocations.map((a) => team.find((member) => member.id === a.staffId)?.name).filter(Boolean) as string[];
    const updated = { ...staffFor, collaborators, allocations };
    setStaffFor(updated);
    setRoadmap((current) =>
      current.map((r) => (r.demandId === updated.demandId ? updated : r)),
    );
    register("Alocação do roadmap alterada",`${updated.demandId}: ${allocations.reduce((sum,a)=>sum+a.hours,0)}h distribuídas entre ${collaborators.length} colaborador(es)`,"blue",updated.quarter);
  };
  return (
    <>
      <PageHead
        title="Roadmap trimestral"
        desc="Planeje demandas por quarter e defina os colaboradores responsáveis."
        action={<div className="capacity-actions"><button className="ghost" onClick={createVersion}><I.History /> Criar versão V{Math.max(0,...versions.map((item)=>item.version))+1}</button><button className="primary" onClick={openPicker}><I.ListPlus /> Planejar demanda cadastrada</button></div>}
      />
      <div className="roadmap-source">
        <I.Link2 />
        <span>
          <b>Demandas são a fonte única.</b> Não é possível criar itens
          diretamente no Roadmap; aqui você apenas planeja demandas já
          cadastradas.
        </span>
        <Badge tone="good">{items.length} neste quarter</Badge>
      </div>
      <div className="toolbar">
        <div className="seg">
          {["Timeline", "Lista"].map((x) => (
            <button
              key={x}
              className={view === x ? "active" : ""}
              onClick={() => setView(x)}
            >
              {x}
            </button>
          ))}
        </div>
        <div className="roadmap-filters">
          <label className="quarter-select">
            <I.Boxes />
            <select aria-label="Filtrar Roadmap por produto" value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
              <option>Todos</option>
              {products.filter((product) => product.active).map((product) => <option key={product.id} value={product.name}>{product.name}</option>)}
            </select>
          </label>
          <label className="quarter-select">
            <I.CalendarRange />
            <select aria-label="Filtrar Roadmap por quarter" value={quarter} onChange={(e) => setQuarter(e.target.value)}>
              {quarters.map((q) => (
                <option key={q}>{q}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {items.length === 0 ? (
        <Card className="roadmap-empty">
          <I.Map />
          <h3>Nenhuma demanda em {quarter}</h3>
          <p>
            Planeje uma demanda cadastrada ou mova uma demanda de outro quarter.
          </p>
          <button className="primary" onClick={openPicker}>
            <I.ListPlus /> Selecionar demanda
          </button>
        </Card>
      ) : view === "Timeline" ? (
        <Timeline
          items={items}
          months={months}
          quarter={quarter}
          onMove={move}
          onStaff={setStaffFor}
        />
      ) : (
        <RoadmapList
          items={items}
          onMove={move}
          onStaff={setStaffFor}
          onRemove={remove}
        />
      )}
      {picker && (
        <div
          className="overlay roadmap-picker-overlay"
        >
          <div
            className="roadmap-picker"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <span className="modal-icon">
                  <I.ListPlus />
                </span>
                <div>
                  <h2>Planejar demanda em {quarter}</h2>
                  <p>
                    Somente demandas previamente cadastradas estão disponíveis.
                  </p>
                </div>
              </div>
              <button className="modal-close" onClick={() => setPicker(false)} aria-label="Fechar seleção de demandas">
                <I.X />
              </button>
            </div>
            <label className="roadmap-picker-product">Produto
              <select value={pickerProduct} onChange={event => setPickerProduct(event.target.value)}>
                <option value="">Selecione um produto...</option>
                {pickerProducts.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <div className="picker-list">
              {!pickerProduct ? (
                <div className="picker-empty"><I.Boxes/><b>Selecione um produto</b><span>As demandas disponíveis aparecerão aqui.</span></div>
              ) : availableForProduct.length === 0 ? (
                <div className="picker-empty">
                  <I.CircleCheck />
                  <b>Nenhuma demanda disponível para {pickerProduct}</b>
                  <span>
                    Cadastre uma demanda ou escolha outro produto.
                  </span>
                </div>
              ) : (
                availableForProduct.map((d) => (
                  <button key={d.id} onClick={() => add(d.id)}>
                    <span className="person">{d.owner?.[0] || d.name[0]}</span>
                    <div>
                      <b>{d.name}</b>
                      <small>
                        {d.id} · {d.product} · {d.effort}h
                      </small>
                    </div>
                    <Badge tone={d.priority === "Crítica" ? "bad" : "gray"}>
                      {d.priority}
                    </Badge>
                    <I.Plus />
                  </button>
                ))
              )}
            </div>
            <div className="picker-foot">
              <button className="primary" onClick={() => setPicker(false)}>
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}
      {staffFor && (
        <div
          className="overlay confirm-overlay"
          onMouseDown={() => setStaffFor(null)}
        >
          <div
            className="staff-roadmap-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <span className="modal-icon">
                  <I.UsersRound />
                </span>
                <div>
                  <h2>Colaboradores da demanda</h2>
                  <p>{rows.find((d) => d.id === staffFor.demandId)?.name}</p>
                </div>
              </div>
              <button className="modal-close" onClick={() => setStaffFor(null)}>
                <I.X />
              </button>
            </div>
            <div className="staff-check-list">
              {team.filter((person) => person.product === rows.find((d) => d.id === staffFor.demandId)?.product).map((person) => (
                <label key={person.id}>
                  <span className="avatar">
                    {person.name
                      .split(" ")
                      .map((x) => x[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <div>
                    <b>{person.name}</b>
                    <small>
                      {person.role} · {person.total}h de capacidade
                    </small>
                  </div>
                  <div className="allocation-hours"><input type="number" min="0" max={person.total} value={staffFor.allocations.find((a) => a.staffId === person.id)?.hours || 0} onChange={(e) => updateAllocation(person, Number(e.target.value))}/><span>horas</span></div>
                </label>
              ))}
            </div>
            <div className="allocation-total"><span>Total alocado</span><b>{staffFor.allocations.reduce((sum,a)=>sum+a.hours,0)}h / {rows.find((d)=>d.id===staffFor.demandId)?.effort || 0}h</b></div>
            <div className="picker-foot">
              <button className="primary" onClick={() => setStaffFor(null)}>
                <I.Check /> Concluir
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
function Timeline({
  items,
  months,
  quarter,
  onMove,
  onStaff,
}: {
  items: { demand: Demand; entry: RoadmapEntry }[];
  months: string[];
  quarter: string;
  onMove: (id: string, quarter: string) => void;
  onStaff: (entry: RoadmapEntry) => void;
}) {
  const [quarterName,yearText]=quarter.split(" ");
  const quarterIndex=Number(quarterName.slice(1))-1;
  const quarterStart=new Date(Number(yearText),quarterIndex*3,1).getTime();
  const quarterEnd=new Date(Number(yearText),quarterIndex*3+3,0,23,59,59).getTime();
  const span=quarterEnd-quarterStart;
  const position=(d:Demand)=>{const start=Math.max(quarterStart,new Date(`${d.startDate || `${yearText}-${String(quarterIndex*3+1).padStart(2,"0")}-01`}T12:00:00`).getTime());const end=Math.min(quarterEnd,new Date(`${d.dueDate || d.startDate || `${yearText}-${String(quarterIndex*3+3).padStart(2,"0")}-28`}T12:00:00`).getTime());const left=Math.max(0,Math.min(100,(start-quarterStart)/span*100));const width=Math.max(4,Math.min(100-left,(end-start)/span*100));return {left:`${left}%`,width:`${width}%`}};
  return (
    <Card>
      <div className="timeline">
        <div className="tlhead">
          <b>Demanda</b>
          {months.map((month) => (
            <span key={month}>{month}</span>
          ))}
        </div>
        {items.map(({ demand: d, entry }, i) => (
          <div className="tlrow" key={d.id}>
            <div>
              <b>{d.name}</b>
              <small>
                {d.id} · {entry.collaborators.length || 0} colaborador(es) ·{" "}
                {d.effort}h
              </small>
            </div>
            <div className="track">
              <span
                className={"bar b" + (i % 5)}
                style={position(d)}
                onClick={() => onStaff(entry)}
                title="Ver colaboradores alocados"
              >
                <em>{d.progress}% · {d.startDate ? new Date(d.startDate+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"short"}) : "início não informado"}</em>
              </span>
              <i style={{ left: "66%" }} />
              <div className="timeline-actions">
                <button
                  title="Definir colaboradores"
                  onClick={() => onStaff(entry)}
                >
                  <I.Users />
                </button>
                <select
                  title="Mover para outro quarter"
                  value={entry.quarter}
                  onChange={(e) => onMove(d.id, e.target.value)}
                >
                  {quarters.map((q) => (
                    <option key={q}>{q}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
function RoadmapList({
  items,
  onMove,
  onStaff,
  onRemove,
}: {
  items: { demand: Demand; entry: RoadmapEntry }[];
  onMove: (id: string, quarter: string) => void;
  onStaff: (entry: RoadmapEntry) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Card>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Demanda</th>
              <th>Produto</th>
              <th>Colaboradores</th>
              <th>Status</th>
              <th>Prioridade</th>
              <th>Esforço</th>
              <th>Quarter</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ demand: d, entry }) => (
              <tr key={d.id}>
                <td>
                  <b>{d.name}</b>
                  <small>{d.id}</small>
                </td>
                <td>{d.product}</td>
                <td>
                  <button className="staff-link" onClick={() => onStaff(entry)}>
                    <I.Users />
                    {entry.collaborators.length
                      ? `${entry.collaborators.length} alocados`
                      : "Adicionar"}
                  </button>
                </td>
                <td>
                  <Badge>{d.status}</Badge>
                </td>
                <td>{d.priority}</td>
                <td>{d.effort}h</td>
                <td>
                  <select
                    className="quarter-inline"
                    value={entry.quarter}
                    onChange={(e) => onMove(d.id, e.target.value)}
                  >
                    {quarters.map((q) => (
                      <option key={q}>{q}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    className="unlink-button"
                    onClick={() => onRemove(d.id)}
                  >
                    <I.Unlink /> Remover
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const emptyDemandForm = {
  name: "",
  description: "",
  product: "nddMove",
  type: "Evolutiva",
  version: "",
  origin: "Produto",
  requester: "",
  priority: "Média",
  status: "Backlog",
  progress: "0",
  due: "",
  startDate: "",
  effort: "40",
  actualEffort: "",
  billable: "false",
  billedAmount: "",
  owner: "",
  dependencies: "",
  justification: "",
  impact: "",
  resourceIds: [] as number[],
  planningQuarter: "Planejamento",
};
function Demands() {
  const [q, setQ] = useState("");
  const { rows, setRows, roadmap, setRoadmap, setHistory } = useDemands();
  const { products } = useProducts();
  const { team } = useTeam();
  const [modal, setModal] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<Demand | null>(null);
  const [quickEditing, setQuickEditing] = useState<Demand | null>(null);
  const [quickForm, setQuickForm] = useState({ progress: "0", actualEffort: "", due: "" });
  const [quickError, setQuickError] = useState("");
  const [removing, setRemoving] = useState<Demand | null>(null);
  const [viewing, setViewing] = useState<Demand | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState(emptyDemandForm);
  const fileRef=useRef<HTMLInputElement>(null);
  const [importing,setImporting]=useState(false);
  const [importFeedback,setImportFeedback]=useState("");
  const [productFilter,setProductFilter]=useState("Todos");
  const [quarterFilter,setQuarterFilter]=useState("Todos");
  const [executionFilter,setExecutionFilter]=useState("Todas");
  const [statusFilter,setStatusFilter]=useState("Todos");
  const selectedProduct = products.find((product) => product.name === form.product);
  const availableResources = team.filter((person) => person.product === form.product);
  const statusOptions=Array.from(new Set(rows.map((d)=>d.status))).sort();
  const now=new Date();
  const today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  const filtered = rows.filter((d) => {
    const planning=roadmap.find((item)=>item.demandId===d.id);
    const matchesQuarter=quarterFilter==="Todos"||(quarterFilter==="Planejamento"?!planning:planning?.quarter===quarterFilter);
    const runningToday=Boolean(d.startDate&&d.dueDate&&d.startDate<=today&&d.dueDate>=today);
    return (d.name+d.id+d.product).toLowerCase().includes(q.toLowerCase())&&(productFilter==="Todos"||d.product===productFilter)&&matchesQuarter&&(executionFilter==="Todas"||runningToday)&&(statusFilter==="Todos"||d.status===statusFilter);
  });
  const change = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) => {
    if (e.target.name === "product") {
      setForm({ ...form, product: e.target.value, resourceIds: [] });
      return;
    }
    if (e.target.name === "billable") {
      setForm({ ...form, billable: e.target.value, billedAmount: e.target.value === "true" ? form.billedAmount : "" });
      return;
    }
    if (e.target.name === "status" && e.target.value === "Concluído") {
      setForm({ ...form, status: "Concluído", progress: "100" });
      return;
    }
    setForm({ ...form, [e.target.name]: e.target.value });
  };
  const importExcel=async(e:React.ChangeEvent<HTMLInputElement>)=>{const file=e.target.files?.[0];if(!file)return;setImporting(true);setImportFeedback("");try{const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await file.arrayBuffer());const sheet=workbook.worksheets[0];if(!sheet)throw new Error("Planilha sem conteúdo");const headers:Record<number,string>={};sheet.getRow(1).eachCell((cell,col)=>{headers[col]=String(cell.text).trim().toLowerCase()});const imported:Demand[]=[];let ignored=0;const text=(row:ExcelJS.Row,names:string[])=>{const col=Object.entries(headers).find(([,header])=>names.includes(header))?.[0];return col?row.getCell(Number(col)).text.trim():""};const iso=(value:string)=>{if(!value)return "";const match=value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);return match?`${match[3]}-${match[2].padStart(2,"0")}-${match[1].padStart(2,"0")}`: /^\d{4}-\d{2}-\d{2}$/.test(value)?value:""};const nextId=Math.max(...rows.map((d)=>Number(d.id.replace(/\D/g,""))||0),159)+1;sheet.eachRow((row,rowNumber)=>{if(rowNumber===1)return;const name=text(row,["demanda","título","titulo"]);const productText=text(row,["produto"]);const product=products.find((p)=>p.name.toLowerCase()===productText.toLowerCase()&&p.active);if(!name||!product){ignored++;return}const dueDate=iso(text(row,["prazo","prazo desejado","data fim","data de fim"]));const effort=Number(text(row,["capacidade estimada","esforço","esforco","horas"]).replace(",","."))||0;imported.push({id:`DEV-${nextId+imported.length}`,name,product:product.name,owner:product.coordinator.split(" ")[0],status:text(row,["status"])||"Backlog",priority:text(row,["prioridade"])||"Média",effort,progress:0,due:dueDate?new Date(dueDate+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"short"}).replace(".",""):"Sem prazo",dueDate,startDate:iso(text(row,["data de início","data de inicio","início","inicio"])),risk:"Médio",type:text(row,["categoria","tipo"])||"Evolutiva",version:text(row,["versão","versao"]),notes:text(row,["observações","observacoes"]),resourceIds:[]})});if(imported.length)setRows((current)=>[...imported,...current]);setImportFeedback(`${imported.length} demanda(s) importada(s)${ignored?` · ${ignored} linha(s) ignorada(s)`:""}.`)}catch{setImportFeedback("Não foi possível ler a planilha. Verifique o formato e os cabeçalhos.")}finally{setImporting(false);e.target.value=""}};
  const close = () => {
    setModal(false);
    setEditing(null);
    setErrors({});
    setForm(emptyDemandForm);
  };
  const openNew = () => {
    setEditing(null);
    setForm(emptyDemandForm);
    setModal(true);
  };
  const openEdit = (d: Demand) => {
    const month: Record<string, string> = {
      jan: "01",
      fev: "02",
      mar: "03",
      abr: "04",
      mai: "05",
      jun: "06",
      jul: "07",
      ago: "08",
      set: "09",
      out: "10",
      nov: "11",
      dez: "12",
    };
    const parts = d.due.toLowerCase().split(" ");
    setEditing(d);
    setForm({
      ...emptyDemandForm,
      name: d.name,
      product: d.product,
      priority: d.priority,
      status: d.status,
      progress: String(d.progress),
      type: d.type || "Evolutiva",
      version: d.version || "",
      description: d.notes || "",
      effort: String(d.effort),
      actualEffort: d.actualEffort === undefined ? "" : String(d.actualEffort),
      billable: String(d.billable ?? false),
      billedAmount: d.billedAmount === undefined ? "" : String(d.billedAmount),
      owner: d.owner,
      requester: d.owner,
      startDate: d.startDate || "",
      due: d.dueDate || (parts.length === 2 ? `2026-${month[parts[1]] || "09"}-${parts[0].padStart(2, "0")}` : ""),
      resourceIds: d.resourceIds || [],
    });
    setModal(true);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = "Informe o título da demanda.";
    if (!form.product) next.product = "Selecione um produto cadastrado.";
    if (!form.requester.trim()) next.requester = "Informe o solicitante.";
    if (!form.due) next.due = "Informe o prazo desejado.";
    if (Number(form.effort) <= 0) next.effort = "Informe um esforço válido.";
    if (form.actualEffort !== "" && (!Number.isFinite(Number(form.actualEffort)) || Number(form.actualEffort) < 0)) next.actualEffort = "Informe um esforço realizado válido.";
    const billedAmount = Number(form.billedAmount);
    if (form.billable === "true" && (!Number.isFinite(billedAmount) || billedAmount < 0 || Math.abs(billedAmount * 100 - Math.round(billedAmount * 100)) > 0.000001)) next.billedAmount = "Informe um valor não negativo com até duas casas decimais.";
    setErrors(next);
    if (Object.keys(next).length) return;
    const date = new Date(form.due + "T12:00:00");
    const due = date
      .toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
      .replace(".", "");
    const data: Demand = {
      id: editing?.id || `DEV-${160 + rows.length}`,
      name: form.name.trim(),
      product: form.product,
      owner: selectedProduct?.coordinator.split(" ")[0] || "Time",
      status: Number(form.progress) === 100 ? "Concluído" : form.status,
      priority: form.priority,
      effort: Number(form.effort),
      actualEffort: form.actualEffort === "" ? undefined : Number(form.actualEffort),
      billable: form.billable === "true",
      billedAmount: form.billable === "true" ? Math.round(billedAmount * 100) / 100 : 0,
      progress: Math.min(100, Math.max(0, Number(form.progress) || 0)),
      due,
      dueDate: form.due,
      risk: form.priority === "Crítica" ? "Alto" : editing?.risk || "Médio",
      type: form.type,
      version: form.version,
      notes: form.description,
      startDate: form.startDate,
      resourceIds: form.resourceIds,
    };
    setRows(
      editing
        ? rows.map((row) => (row.id === editing.id ? data : row))
        : [data, ...rows],
    );
    if(!editing && form.planningQuarter!=="Planejamento"){
      setRoadmap((current)=>[...current,{demandId:data.id,quarter:form.planningQuarter,collaborators:[],allocations:[]}]);
      setHistory((current)=>[{id:Date.now(),date:new Date().toLocaleString("pt-BR"),title:"Demanda planejada no cadastro",actor:"Vagner Moraes",detail:`${data.id} incluída em ${form.planningQuarter}`,tone:"good",product:data.product,quarter:form.planningQuarter},...current]);
    }
    close();
    setSaved(true);
    setTimeout(() => setSaved(false), 3500);
  };
  const openQuickEdit = (demand: Demand) => {
    setQuickEditing(demand);
    setQuickForm({ progress: String(demand.progress), actualEffort: demand.actualEffort === undefined ? "" : String(demand.actualEffort), due: demand.dueDate || "" });
    setQuickError("");
  };
  const saveQuickEdit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!quickEditing) return;
    const progress = Number(quickForm.progress);
    const actualEffort = Number(quickForm.actualEffort);
    if (quickForm.progress.trim() === "" || !Number.isInteger(progress) || progress < 0 || progress > 100 || (quickForm.actualEffort.trim() !== "" && (!Number.isFinite(actualEffort) || actualEffort < 0))) {
      setQuickError("Informe uma evolução de 0 a 100% e um esforço realizado válido.");
      return;
    }
    const due = quickForm.due ? new Date(`${quickForm.due}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "") : quickEditing.dueDate ? "Sem prazo" : quickEditing.due;
    const wasCompleted = ["Concluído", "Concluída"].includes(quickEditing.status);
    setRows(current => current.map(demand => demand.id === quickEditing.id ? {
      ...demand, progress, actualEffort: quickForm.actualEffort.trim() === "" ? undefined : actualEffort, due, dueDate: quickForm.due,
      status: progress === 100 ? "Concluído" : wasCompleted ? (progress === 0 ? "Backlog" : "Desenvolvimento") : demand.status,
    } : demand));
    setQuickEditing(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 3500);
  };
  const confirmRemove = () => {
    if (!removing) return;
    const removed = removing;
    setRows((current) => current.filter((row) => row.id !== removed.id));
    setRoadmap((current) => current.filter((item) => item.demandId !== removed.id));
    setHistory((current) => [{
      id: Date.now(),
      date: new Date().toLocaleString("pt-BR"),
      title: "Demanda excluída",
      actor: "Vagner Moraes",
      detail: `${removed.id} removida da gestão de demandas e do Roadmap`,
      tone: "bad",
      product: removed.product,
      quarter: roadmap.find((item) => item.demandId === removed.id)?.quarter,
      demandId: removed.id,
      demandName: removed.name,
    }, ...current]);
    setRemoving(null);
  };
  return (
    <>
      <PageHead
        title="Gestão de demandas"
        desc="Priorize, acompanhe e entenda o impacto de cada entrega."
        action={
          <button className="primary" onClick={openNew}>
            <I.Plus /> Nova demanda
          </button>
        }
      />
      <div className="toolbar">
        <label className="search inner">
          <I.Search />
          <input
            placeholder="Buscar demandas..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label className="demand-filter"><I.Boxes/><span>Produto</span><select aria-label="Filtrar por produto" value={productFilter} onChange={(e)=>setProductFilter(e.target.value)}><option value="Todos">Todos os produtos</option>{products.filter((product)=>product.active).map((product)=><option key={product.id} value={product.name}>{product.name}</option>)}</select></label>
        <label className="demand-filter"><I.CalendarRange/><span>Quarter</span><select aria-label="Filtrar por quarter" value={quarterFilter} onChange={(e)=>setQuarterFilter(e.target.value)}><option value="Todos">Todos os quarters</option><option>Planejamento</option>{quarters.map((quarter)=><option key={quarter}>{quarter}</option>)}</select></label>
        <label className="demand-filter"><I.Activity/><span>Período</span><select aria-label="Filtrar demandas em execução" value={executionFilter} onChange={(e)=>setExecutionFilter(e.target.value)}><option>Todas</option><option value="Em execução hoje">Em execução hoje</option></select></label>
        <label className="demand-filter"><I.ListFilter/><span>Status</span><select aria-label="Filtrar por status" value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value)}><option value="Todos">Todos os status</option>{statusOptions.map((status)=><option key={status} value={status}>{status}</option>)}</select></label>
        {(productFilter!=="Todos"||quarterFilter!=="Todos"||executionFilter!=="Todas"||statusFilter!=="Todos")&&<button onClick={()=>{setProductFilter("Todos");setQuarterFilter("Todos");setExecutionFilter("Todas");setStatusFilter("Todos")}}><I.X/> Limpar</button>}
        <button onClick={()=>fileRef.current?.click()} disabled={importing}>
          {importing?<I.LoaderCircle className="spin"/>:<I.FileSpreadsheet/>} {importing?"Importando...":"Importar Excel"}
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={importExcel}/>
      </div>
      {importFeedback&&<div className="import-feedback"><I.CircleCheck/><span>{importFeedback}</span><button onClick={()=>setImportFeedback("")}><I.X/></button></div>}
      <Card>
        <div className="cardhead">
          <div>
            <h3>Todas as demandas</h3>
            <p>{filtered.length} resultados · atualizado agora</p>
          </div>
          <div className="seg">
            <button className="active">
              <I.List /> Lista
            </button>
            <button>
              <I.Columns3 /> Board
            </button>
          </div>
        </div>
        <DemandTableRows
          rows={filtered}
          onView={setViewing}
          onEdit={openEdit}
          onQuickEdit={openQuickEdit}
          onRemove={setRemoving}
        />
      </Card>
      {viewing && (
        <div className="overlay confirm-overlay" onMouseDown={() => setViewing(null)}>
          <div className="demand-summary-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div><span className="modal-icon"><I.ClipboardList /></span><div><h2>{viewing.name}</h2><p>{viewing.id} · {viewing.product}</p></div></div>
              <button className="modal-close" onClick={() => setViewing(null)}><I.X /></button>
            </div>
            <div className="demand-summary-grid">
              <div><span>Status</span><b>{viewing.status}</b></div>
              <div><span>Prioridade</span><b>{viewing.priority}</b></div>
              <div><span>Categoria</span><b>{viewing.type || "Não informada"}</b></div>
              <div><span>Responsável</span><b>{viewing.owner}</b></div>
              <div><span>Data de início</span><b>{viewing.startDate ? new Date(viewing.startDate + "T12:00:00").toLocaleDateString("pt-BR") : "Não informada"}</b></div>
              <div><span>Prazo desejado</span><b>{viewing.dueDate ? new Date(viewing.dueDate + "T12:00:00").toLocaleDateString("pt-BR") : viewing.due}</b></div>
              <div><span>Esforço estimado</span><b>{viewing.effort}h</b></div>
              <div><span>Esforço realizado</span><b>{viewing.actualEffort === undefined ? "Não informado" : `${viewing.actualEffort}h`}</b></div>
              <div><span>Evolução</span><b>{viewing.progress}%</b></div>
              <div><span>Quarter</span><b>{roadmap.find((item) => item.demandId === viewing.id)?.quarter || "Planejamento"}</b></div>
              <div className="wide"><span>Recursos</span><b>{(viewing.resourceIds || []).map((id) => team.find((person) => person.id === id)?.name).filter(Boolean).join(", ") || "Nenhum recurso alocado"}</b></div>
              <div className="wide"><span>Observações</span><p>{viewing.notes || "Nenhuma observação cadastrada."}</p></div>
            </div>
            <div className="picker-foot"><button className="primary" onClick={() => setViewing(null)}>Fechar</button></div>
          </div>
        </div>
      )}
      {quickEditing && <div className="overlay confirm-overlay" onMouseDown={() => setQuickEditing(null)}><form className="demand-summary-modal" onMouseDown={event => event.stopPropagation()} onSubmit={saveQuickEdit}><div className="modal-head"><div><span className="modal-icon"><I.SlidersHorizontal/></span><div><h2>Atualizar evolução e planejamento</h2><p>{quickEditing.name} · {quickEditing.id}</p></div></div><button type="button" className="modal-close" onClick={() => setQuickEditing(null)} aria-label="Fechar"><I.X/></button></div><div className="modal-body"><div className="form-field"><label htmlFor="quickProgress">Evolução da demanda (%)</label><input id="quickProgress" type="number" min="0" max="100" step="1" required value={quickForm.progress} onChange={event => setQuickForm({ ...quickForm, progress: event.target.value })}/></div><div className="form-field"><label htmlFor="quickActualEffort">Esforço realizado (horas)</label><input id="quickActualEffort" type="number" min="0" step="0.5" value={quickForm.actualEffort} onChange={event => setQuickForm({ ...quickForm, actualEffort: event.target.value })}/></div><div className="form-field wide"><label htmlFor="quickDue">Prazo desejado</label><input id="quickDue" type="date" value={quickForm.due} onChange={event => setQuickForm({ ...quickForm, due: event.target.value })}/></div>{quickError && <p className="auth-error" role="alert">{quickError}</p>}</div><div className="modal-actions"><button type="button" className="ghost" onClick={() => setQuickEditing(null)}>Cancelar</button><button type="submit" className="primary"><I.Save/> Salvar alterações</button></div></form></div>}
      {modal && (
        <div className="overlay demand-overlay" onMouseDown={close}>
          <form
            className="demand-modal"
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={submit}
          >
            <div className="modal-head">
              <div>
                <span className="modal-icon">
                  <I.ListPlus />
                </span>
                <div>
                  <h2>{editing ? "Editar demanda" : "Nova demanda"}</h2>
                  <p>
                    Cadastre a demanda para avaliar seu impacto no planejamento.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={close}
                aria-label="Fechar"
              >
                <I.X />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-field wide">
                <label htmlFor="name">
                  Título <em>*</em>
                </label>
                <input
                  id="name"
                  name="name"
                  value={form.name}
                  onChange={change}
                  placeholder="Ex.: Integração com novo gateway"
                  autoFocus
                  className={errors.name ? "invalid" : ""}
                />
                {errors.name && (
                  <small className="field-error">{errors.name}</small>
                )}
              </div>
              <div className="form-field wide">
                <label htmlFor="description">Descrição</label>
                <textarea
                  id="description"
                  name="description"
                  value={form.description}
                  onChange={change}
                  placeholder="Descreva o contexto e o resultado esperado"
                  rows={3}
                />
              </div>
              <div className="form-field">
                <label>
                  Produto <em>*</em>
                </label>
                <select
                  name="product"
                  value={form.product}
                  onChange={change}
                  className={errors.product ? "invalid" : ""}
                >
                  <option value="">Selecione um produto...</option>
                  {products
                    .filter((product) => product.active)
                    .map((product) => (
                      <option key={product.id} value={product.name}>
                        {product.name}
                      </option>
                    ))}
                </select>
                {errors.product && (
                  <small className="field-error">{errors.product}</small>
                )}
              </div>
              <div className="form-field team-readonly"><label>Time responsável <I.Lock/></label><div><I.UsersRound/><span><b>{selectedProduct?.team || "Selecione um produto"}</b><small>{selectedProduct ? `Coordenador: ${selectedProduct.coordinator}` : "Preenchido automaticamente"}</small></span></div></div>
              <div className="form-field wide"><label>Recursos</label><div className="resource-selector">{!form.product?<p>Selecione um produto para visualizar os colaboradores da squad.</p>:availableResources.length===0?<p>Nenhum colaborador cadastrado para {selectedProduct?.team}.</p>:availableResources.map((person)=><label key={person.id} className={form.resourceIds.includes(person.id)?"selected":""}><input type="checkbox" checked={form.resourceIds.includes(person.id)} onChange={()=>setForm({...form,resourceIds:form.resourceIds.includes(person.id)?form.resourceIds.filter((id)=>id!==person.id):[...form.resourceIds,person.id]})}/><span className="avatar">{person.name.split(" ").map((x)=>x[0]).slice(0,2).join("")}</span><span><b>{person.name}</b><small>{person.role} · {person.total}h de capacidade</small></span></label>)}</div><small className="resource-help">{form.resourceIds.length} recurso(s) selecionado(s)</small></div>
              <div className="form-field">
                <label>
                  Categoria <em>*</em>
                </label>
                <select name="type" value={form.type} onChange={change}>
                  <option>Estratégica</option>
                  <option>Evolutiva</option>
                  <option>Bug</option>
                  <option>Incidente</option>
                  <option>Sustentação</option>
                  <option>Regulatória</option>
                  <option>Técnica</option>
                  <option>Emergencial</option>
                </select>
              </div>
              <div className="form-field">
                <label>Origem</label>
                <select name="origin" value={form.origin} onChange={change}>
                  <option>Produto</option>
                  <option>Cliente</option>
                  <option>Tecnologia</option>
                  <option>Regulatório</option>
                  <option>Operações</option>
                </select>
              </div>
              <div className="form-field"><label>Versão</label><input name="version" value={form.version} onChange={change} placeholder="Ex.: 5.2"/></div>
              <div className="form-field">
                <label htmlFor="requester">
                  Solicitante <em>*</em>
                </label>
                <input
                  id="requester"
                  name="requester"
                  value={form.requester}
                  onChange={change}
                  placeholder="Nome do solicitante"
                  className={errors.requester ? "invalid" : ""}
                />
                {errors.requester && (
                  <small className="field-error">{errors.requester}</small>
                )}
              </div>
              <div className="form-field">
                <label>Prioridade</label>
                <select name="priority" value={form.priority} onChange={change}>
                  <option>Baixa</option>
                  <option>Média</option>
                  <option>Alta</option>
                  <option>Crítica</option>
                </select>
              </div>
              <div className="form-field"><label>Status</label><select name="status" value={form.status} onChange={change}><option>Backlog</option><option>Planejada</option><option>Em análise</option><option>Desenvolvimento</option><option>Em testes</option><option>Homologação</option><option>Concluído</option><option>Concluída</option><option>Cancelada</option><option>Bloqueada</option></select></div>
              <div className="form-field"><label htmlFor="demandProgress">Evolução da demanda (%)</label><input id="demandProgress" type="number" name="progress" min="0" max="100" step="1" value={form.progress} onChange={(e)=>{const progress=String(Math.min(100,Math.max(0,Number(e.target.value))));setForm({...form,progress,status:Number(progress)===100?"Concluído":form.status})}}/><small className="resource-help">Ao atingir 100%, o status será alterado para Concluído.</small></div>
              {!editing&&<div className="form-field"><label>Planejamento inicial</label><select name="planningQuarter" value={form.planningQuarter} onChange={change}><option value="Planejamento">Deixar em planejamento</option>{quarters.map((quarter)=><option key={quarter}>{quarter}</option>)}</select><small className="resource-help">O quarter pertence ao planejamento, não à demanda.</small></div>}
              <div className="form-field">
                <label htmlFor="startDate">Data de início</label>
                <input id="startDate" type="date" name="startDate" value={form.startDate} onChange={change}/>
              </div>
              <div className="form-field">
                <label htmlFor="due">
                  Prazo desejado <em>*</em>
                </label>
                <input
                  id="due"
                  type="date"
                  name="due"
                  value={form.due}
                  onChange={change}
                  className={errors.due ? "invalid" : ""}
                />
                {errors.due && (
                  <small className="field-error">{errors.due}</small>
                )}
              </div>
              <div className="form-field">
                <label htmlFor="effort">Esforço estimado (horas)</label>
                <input
                  id="effort"
                  type="number"
                  min="1"
                  name="effort"
                  value={form.effort}
                  onChange={change}
                  className={errors.effort ? "invalid" : ""}
                />
                {errors.effort && (
                  <small className="field-error">{errors.effort}</small>
                )}
              </div>
              <div className="form-field"><label htmlFor="actualEffort">Esforço realizado (horas)</label><input id="actualEffort" type="number" min="0" step="0.5" name="actualEffort" value={form.actualEffort} onChange={change} placeholder="Ainda não informado" className={errors.actualEffort ? "invalid" : ""}/>{errors.actualEffort && <small className="field-error">{errors.actualEffort}</small>}</div>
              <div className="form-field wide">
                <label htmlFor="billable">Faturamento</label>
                <select id="billable" name="billable" value={form.billable} onChange={change}>
                  <option value="false">Não faturável</option>
                  <option value="true">Faturável</option>
                </select>
              </div>
              <div className="form-field wide">
                <label htmlFor="billedAmount">Valor faturado (R$)</label>
                <input id="billedAmount" name="billedAmount" type="number" min="0" step="0.01" value={form.billedAmount} onChange={change} disabled={form.billable !== "true"} placeholder="0,00" className={errors.billedAmount ? "invalid" : ""}/>
                <small className="resource-help">Um valor maior que zero identifica a demanda como faturada. Deixe vazio ou zero enquanto não houver faturamento.</small>
                {errors.billedAmount && <small className="field-error" role="alert">{errors.billedAmount}</small>}
              </div>
              <div className="form-field wide">
                <label>Dependências</label>
                <input
                  name="dependencies"
                  value={form.dependencies}
                  onChange={change}
                  placeholder="Outros times, sistemas ou demandas"
                />
              </div>
              <div className="form-field">
                <label>Justificativa</label>
                <textarea
                  name="justification"
                  value={form.justification}
                  onChange={change}
                  rows={2}
                  placeholder="Por que esta demanda é necessária?"
                />
              </div>
              <div className="form-field">
                <label>Impacto esperado</label>
                <textarea
                  name="impact"
                  value={form.impact}
                  onChange={change}
                  rows={2}
                  placeholder="Benefícios e resultados esperados"
                />
              </div>
            </div>
            <div className="capacity-preview">
              <I.Gauge />
              <div>
                <b>Impacto preliminar na capacidade</b>
                <p>
                  A demanda consumirá {form.effort || 0}h. O impacto detalhado
                  será calculado após o cadastro.
                </p>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={close}>
                Cancelar
              </button>
              <button type="submit" className="primary">
                <I.Plus /> Cadastrar demanda
              </button>
            </div>
          </form>
        </div>
      )}
      {removing && (
        <div
          className="overlay confirm-overlay"
          onMouseDown={() => setRemoving(null)}
        >
          <div
            className="confirm-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <span>
              <I.Trash2 />
            </span>
            <h3>Excluir demanda?</h3>
            <p>
              A demanda{" "}
              <b>
                {removing.id} — {removing.name}
              </b>{" "}
              será removida da lista. Esta ação não poderá ser desfeita.
            </p>
            <div>
              <button className="ghost" onClick={() => setRemoving(null)}>
                Cancelar
              </button>
              <button className="danger" onClick={confirmRemove}>
                <I.Trash2 /> Excluir demanda
              </button>
            </div>
          </div>
        </div>
      )}
      {saved && (
        <div className="toast-success">
          <I.CircleCheck />
          <div>
            <b>Demanda salva</b>
            <span>As informações foram atualizadas com sucesso.</span>
          </div>
          <button onClick={() => setSaved(false)}>
            <I.X />
          </button>
        </div>
      )}
    </>
  );
}
function DemandTableRows({
  rows,
  onView,
  onEdit,
  onQuickEdit,
  onRemove,
}: {
  rows: Demand[];
  onView?: (d: Demand) => void;
  onEdit?: (d: Demand) => void;
  onQuickEdit?: (d: Demand) => void;
  onRemove?: (d: Demand) => void;
}) {
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Demanda</th>
            <th>Produto</th>
            <th>Responsável</th>
            <th>Status</th>
            <th>Prioridade</th>
            <th>Progresso</th>
            <th>Prazo</th>
            <th>Risco</th>
            {onEdit && <th className="actions-head">Ações</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td>
                {onView ? <button className="demand-title-button" onClick={() => onView(d)}>{d.name}</button> : <b>{d.name}</b>}
                <small>{d.id}</small>
              </td>
              <td>{d.product}</td>
              <td>
                <span className="person">{d.owner[0]}</span>
                {d.owner}
              </td>
              <td>
                <Badge
                  tone={
                    d.status === "Bloqueada"
                      ? "bad"
                      : ["Concluído", "Concluída"].includes(d.status)
                        ? "good"
                        : "blue"
                  }
                >
                  {d.status}
                </Badge>
              </td>
              <td>{d.priority}</td>
              <td>
                <div className="mini">
                  <i style={{ width: d.progress + "%" }} />
                </div>
                <small>{d.progress}%</small>
              </td>
              <td>{d.due}</td>
              <td>
                <Badge
                  tone={
                    d.risk === "Crítico"
                      ? "bad"
                      : d.risk === "Alto"
                        ? "warn"
                        : d.risk === "Baixo"
                          ? "good"
                          : "gray"
                  }
                >
                  {d.risk}
                </Badge>
              </td>
              {onEdit && (
                <td>
                  <div className="row-actions">
                    {onQuickEdit && <button title="Atualizar evolução, esforço realizado e prazo" aria-label={`Atualizar evolução, esforço realizado e prazo de ${d.id}`} onClick={() => onQuickEdit(d)}><I.SlidersHorizontal/></button>}
                    <button
                      title="Editar demanda"
                      aria-label={`Editar ${d.id}`}
                      onClick={() => onEdit(d)}
                    >
                      <I.Pencil />
                    </button>
                    <button
                      className="delete"
                      title="Excluir demanda"
                      aria-label={`Excluir ${d.id}`}
                      onClick={() => onRemove?.(d)}
                    >
                      <I.Trash2 />
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const emptyProduct = { name: "", code: "", description: "", team: "", coordinator: "", active: true };
function Products() {
  const { products, setProducts } = useProducts();
  const { rows } = useDemands();
  const { team } = useTeam();
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState(emptyProduct);
  const [error, setError] = useState("");
  const openNew = () => {
    setEditing(null);
    setForm(emptyProduct);
    setError("");
    setModal(true);
  };
  const openEdit = (product: Product) => {
    setEditing(product);
    setForm({
      name: product.name,
      code: product.code,
      description: product.description,
      team: product.team,
      coordinator: product.coordinator,
      active: product.active,
    });
    setError("");
    setModal(true);
  };
  const close = () => {
    setModal(false);
    setEditing(null);
    setError("");
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.code.trim() || !form.team.trim() || !form.coordinator.trim()) {
      setError("Nome, código, time e coordenador são obrigatórios.");
      return;
    }
    if (
      products.some(
        (p) =>
          p.id !== editing?.id &&
          (p.name.toLowerCase() === form.name.trim().toLowerCase() ||
            p.code.toLowerCase() === form.code.trim().toLowerCase()),
      )
    ) {
      setError("Já existe um produto com esse nome ou código.");
      return;
    }
    const data: Product = {
      id: editing?.id || Date.now(),
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      description: form.description.trim(),
      team: form.team.trim(),
      coordinator: form.coordinator.trim(),
      active: form.active,
    };
    setProducts(
      editing
        ? products.map((p) => (p.id === editing.id ? data : p))
        : [...products, data],
    );
    close();
  };
  const remove = (product: Product) => {
    const usage =
      rows.filter((d) => d.product === product.name).length +
      team.filter((m) => m.product === product.name).length;
    if (usage) {
      setError(
        `O produto ${product.name} não pode ser excluído porque possui ${usage} vínculo(s).`,
      );
      return;
    }
    setProducts(products.filter((p) => p.id !== product.id));
  };
  return (
    <>
      <PageHead
        title="Produtos"
        desc="Cadastre os produtos utilizados por demandas e colaboradores."
        action={
          <button className="primary" onClick={openNew}>
            <I.Plus /> Novo produto
          </button>
        }
      />
      <div className="product-summary">
        <I.Database />
        <span>
          <b>Cadastro mestre</b> Demandas e colaboradores só podem utilizar
          produtos ativos desta lista.
        </span>
        <Badge tone="good">
          {products.filter((p) => p.active).length} ativos
        </Badge>
      </div>
      <div className="product-grid">
        {products.map((product) => {
          const demandsCount = rows.filter(
            (d) => d.product === product.name,
          ).length;
          const staffCount = team.filter(
            (m) => m.product === product.name,
          ).length;
          return (
            <Card className="product-card" key={product.id}>
              <div className="product-code">{product.code}</div>
              <div className="product-info">
                <div>
                  <h3>{product.name}</h3>
                  <Badge tone={product.active ? "good" : "gray"}>
                    {product.active ? "Ativo" : "Inativo"}
                  </Badge>
                </div>
                <p>
                  <I.UsersRound /> {product.team}
                </p>
                <p><I.UserRound /> Coordenador: {product.coordinator}</p>
                <div>
                  <span>
                    <b>{demandsCount}</b> demandas
                  </span>
                  <span>
                    <b>{staffCount}</b> colaboradores
                  </span>
                </div>
              </div>
              <div className="row-actions">
                <button
                  title="Editar produto"
                  onClick={() => openEdit(product)}
                >
                  <I.Pencil />
                </button>
                <button
                  className="delete"
                  title="Excluir produto"
                  onClick={() => remove(product)}
                >
                  <I.Trash2 />
                </button>
              </div>
            </Card>
          );
        })}
      </div>
      {error && !modal && (
        <div className="toast-success product-error">
          <I.CircleAlert />
          <div>
            <b>Produto em uso</b>
            <span>{error}</span>
          </div>
          <button onClick={() => setError("")}>
            <I.X />
          </button>
        </div>
      )}
      {modal && (
        <div className="overlay confirm-overlay" onMouseDown={close}>
          <form
            className="staff-modal"
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={submit}
          >
            <div className="modal-head">
              <div>
                <span className="modal-icon">
                  <I.Boxes />
                </span>
                <div>
                  <h2>{editing ? "Editar produto" : "Novo produto"}</h2>
                  <p>Este produto ficará disponível nos demais cadastros.</p>
                </div>
              </div>
              <button type="button" className="modal-close" onClick={close}>
                <I.X />
              </button>
            </div>
            <div className="staff-form">
              <div className="form-field">
                <label>
                  Nome <em>*</em>
                </label>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ex.: Marketplace"
                />
              </div>
              <div className="form-field">
                <label>
                  Código <em>*</em>
                </label>
                <input
                  value={form.code}
                  maxLength={6}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="Ex.: MKT"
                />
              </div>
              <div className="form-field wide"><label>Descrição</label><textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Contexto e objetivo do produto"/></div>
              <div className="form-field"><label>Time responsável <em>*</em></label><input value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} placeholder="Ex.: Squad Marketplace"/></div>
              <div className="form-field"><label>Coordenador <em>*</em></label><input value={form.coordinator} onChange={(e) => setForm({ ...form, coordinator: e.target.value })} placeholder="Nome do coordenador"/></div>
              <label className="product-active">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) =>
                    setForm({ ...form, active: e.target.checked })
                  }
                />
                <span>
                  <b>Produto ativo</b>
                  <small>Disponível para novas demandas e colaboradores</small>
                </span>
              </label>
              {error && (
                <div className="staff-error">
                  <I.CircleAlert />
                  {error}
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={close}>
                Cancelar
              </button>
              <button className="primary" type="submit">
                <I.Save /> Salvar produto
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

type Staff = {
  id: number;
  name: string;
  role: string;
  product: string;
  total: number;
  used: number;
};
function normalizeStaffRole(role: string) {
  const normalized = role.trim().toUpperCase();
  if (normalized === "COORDENADOR") return "Coordenador";
  if (normalized === "ESPECIALISTA" || normalized === "ESPECIALISTA DEV 1") return "Especialista DEV 1";
  return role.trim();
}
const initialStaff: Staff[] = capacitySeed.map(person => ({ ...person, role: normalizeStaffRole(person.role) }));
function replaceRegisteredStaff() {
  try {
    if (localStorage.getItem("dev-plan:team-spreadsheet-v1")) return;
    localStorage.setItem("dev-plan:team", JSON.stringify(initialStaff));
    const demandsRaw = localStorage.getItem("dev-plan:demands");
    if (demandsRaw) {
      const storedDemands: Demand[] = JSON.parse(demandsRaw);
      localStorage.setItem("dev-plan:demands", JSON.stringify(storedDemands.map(demand => ({ ...demand, resourceIds: [] }))));
    }
    const roadmapRaw = localStorage.getItem("dev-plan:roadmap");
    if (roadmapRaw) {
      const entries: RoadmapEntry[] = JSON.parse(roadmapRaw);
      localStorage.setItem("dev-plan:roadmap", JSON.stringify(entries.map(entry => ({ ...entry, collaborators: [], allocations: [] }))));
    }
    localStorage.setItem("dev-plan:team-spreadsheet-v1", "1");
  } catch { /* A lista da planilha continua disponível sem armazenamento local. */ }
}
replaceRegisteredStaff();
function correctStaffProductsFromSpreadsheet() {
  try {
    if (localStorage.getItem("dev-plan:team-products-v2")) return;
    const raw = localStorage.getItem("dev-plan:team");
    const stored: Staff[] = raw ? JSON.parse(raw) : initialStaff;
    const productByName = new Map(initialStaff.map(person => [person.name, person.product]));
    localStorage.setItem("dev-plan:team", JSON.stringify(stored.map(person => ({
      ...person,
      product: productByName.get(person.name) ?? person.product,
    }))));
    localStorage.setItem("dev-plan:team-products-v2", "1");
  } catch { /* A lista inicial já contém os produtos corrigidos. */ }
}
correctStaffProductsFromSpreadsheet();
function normalizeRegisteredStaffRoles() {
  try {
    if (localStorage.getItem("dev-plan:team-roles-v2")) return;
    const raw = localStorage.getItem("dev-plan:team");
    const stored: Staff[] = raw ? JSON.parse(raw) : initialStaff;
    localStorage.setItem("dev-plan:team", JSON.stringify(stored.map(person => ({ ...person, role: normalizeStaffRole(person.role) }))));
    localStorage.setItem("dev-plan:team-roles-v2", "1");
  } catch { /* A lista inicial já usa as funções atualizadas. */ }
}
normalizeRegisteredStaffRoles();
const TeamContext = createContext<{
  team: Staff[];
  setTeam: React.Dispatch<React.SetStateAction<Staff[]>>;
} | null>(null);
function TeamProvider({ children }: { children: React.ReactNode }) {
  const [team, setTeam] = usePersistentState<Staff[]>("dev-plan:team", initialStaff);
  return (
    <TeamContext.Provider value={{ team, setTeam }}>
      {children}
    </TeamContext.Provider>
  );
}
function useTeam() {
  const value = useContext(TeamContext);
  if (!value) throw new Error("TeamProvider ausente");
  const allowedNames = useAllowedProductNames();
  if (allowedNames === null) return value;
  const canSeePerson = (person: Staff) => allowedNames.has(person.product);
  return { team: value.team.filter(canSeePerson), setTeam: scopedSetter(value.setTeam, canSeePerson) };
}
const emptyStaff = {
  name: "",
  role: "Backend",
  product: "",
  total: "130",
  used: "0",
};
function Capacity() {
  const { team, setTeam } = useTeam();
  const { products } = useProducts();
  const { rows, setRows, roadmap, setRoadmap } = useDemands();
  const [productFilter,setProductFilter]=useState("Todos");
  const [allocationFor,setAllocationFor]=useState<Staff|null>(null);
  const [form, setForm] = useState(emptyStaff);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [removing, setRemoving] = useState<Staff | null>(null);
  const [modal, setModal] = useState(false);
  const [error, setError] = useState("");
  const fileRef=useRef<HTMLInputElement>(null);
  const [importing,setImporting]=useState(false);
  const [importFeedback,setImportFeedback]=useState("");
  const demandAllocations = (person: Staff) => rows.flatMap((demand) => {
    const plan = roadmap.find((item) => item.demandId === demand.id);
    const explicit = plan?.allocations.find((item) => item.staffId === person.id);
    const linkedIds = demand.resourceIds || [];
    const linked = linkedIds.includes(person.id);
    if (!explicit && !linked) return [];

    const explicitTotal = (plan?.allocations || []).reduce((sum, item) => sum + item.hours, 0);
    const linkedWithoutAdjustment = linkedIds.filter(
      (staffId) => !plan?.allocations.some((item) => item.staffId === staffId),
    );
    const remainingEffort = Math.max(0, demand.effort - explicitTotal);
    const calculatedHours = linkedWithoutAdjustment.length
      ? Math.round(remainingEffort / linkedWithoutAdjustment.length)
      : 0;

    return [{
      demand,
      plan: plan || { demandId: demand.id, quarter: "Planejamento", collaborators: [], allocations: [] },
      hours: explicit?.hours ?? calculatedHours,
    }];
  }).filter((item) => item.hours > 0);
  const allocatedDemandHours = (person: Staff) =>
    demandAllocations(person).reduce((sum, item) => sum + item.hours, 0);
  const effectiveUsed = (person: Staff) => allocatedDemandHours(person);
  const filteredTeam=productFilter==="Todos"?team:team.filter((person)=>person.product===productFilter);
  const total = filteredTeam.reduce((sum, m) => sum + m.total, 0);
  const used = filteredTeam.reduce((sum, m) => sum + effectiveUsed(m), 0);
  const free = total - used;
  const overloaded = filteredTeam.filter((m) => effectiveUsed(m) / m.total > 0.9).length;
  const allocatedDemands=allocationFor?demandAllocations(allocationFor):[];
  const importCapacity=async(e:React.ChangeEvent<HTMLInputElement>)=>{const file=e.target.files?.[0];if(!file)return;setImporting(true);setImportFeedback("");try{const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await file.arrayBuffer());const sheet=workbook.worksheets[0];if(!sheet)throw new Error();const headers:Record<number,string>={};sheet.getRow(1).eachCell((cell,col)=>headers[col]=cell.text.trim().toLowerCase());const get=(row:ExcelJS.Row,names:string[])=>{const col=Object.entries(headers).find(([,header])=>names.includes(header))?.[0];return col?row.getCell(Number(col)).text.trim():""};const incoming:Staff[]=[];let ignored=0;sheet.eachRow((row,index)=>{if(index===1)return;const name=get(row,["colaborador","nome","nome completo"]);const productText=get(row,["produto"]);const product=products.find((item)=>item.name.toLowerCase()===productText.toLowerCase()&&item.active);const total=Number(get(row,["capacidade","capacidade total","horas disponíveis","horas disponiveis"]).replace(",","."));if(!name||!product||!total){ignored++;return}incoming.push({id:Date.now()+index,name,role:normalizeStaffRole(get(row,["função","funcao","cargo"])||"Desenvolvedor"),product:product.name,total,used:Number(get(row,["horas alocadas","alocada","alocação","alocacao"]).replace(",","."))||0})});setTeam((current)=>{const next=[...current];incoming.forEach((person)=>{const found=next.findIndex((item)=>item.name.toLowerCase()===person.name.toLowerCase());if(found>=0)next[found]={...person,id:next[found].id};else next.push(person)});return next});setImportFeedback(`${incoming.length} capacidade(s) importada(s)${ignored?` · ${ignored} linha(s) ignorada(s)`:""}.`)}catch{setImportFeedback("Não foi possível ler a planilha de capacidade.")}finally{setImporting(false);e.target.value=""}};
  const openNew = () => {
    setEditing(null);
    setForm(emptyStaff);
    setError("");
    setModal(true);
  };
  const openEdit = (m: Staff) => {
    setEditing(m);
    setForm({
      name: m.name,
      role: m.role,
      product: m.product,
      total: String(m.total),
      used: String(m.used),
    });
    setError("");
    setModal(true);
  };
  const close = () => {
    setModal(false);
    setEditing(null);
    setError("");
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cap = Number(form.total),
      allocation = Number(form.used);
    if (!form.name.trim()) {
      setError("Informe o nome do colaborador.");
      return;
    }
    if (!form.product) {
      setError("Selecione o produto do colaborador.");
      return;
    }
    if (cap <= 0 || allocation < 0) {
      setError("Informe valores válidos para capacidade e alocação.");
      return;
    }
    const data: Staff = {
      id: editing?.id || Date.now(),
      name: form.name.trim(),
      role: form.role,
      product: form.product,
      total: cap,
      used: allocation,
    };
    setTeam(
      editing
        ? team.map((m) => (m.id === editing.id ? data : m))
        : [...team, data],
    );
    close();
  };
  const confirmRemove = () => {
    if (removing) {
      const staffId = removing.id;
      setTeam((current) => current.filter((m) => m.id !== staffId));
      setRows((current) => current.map((demand) => ({
        ...demand,
        resourceIds: demand.resourceIds?.filter((id) => id !== staffId),
      })));
      setRoadmap((current) => current.map((item) => ({
        ...item,
        allocations: item.allocations.filter((allocation) => allocation.staffId !== staffId),
      })));
    }
    setRemoving(null);
  };
  return (
    <>
      <PageHead
        title="Capacidade do time"
        desc="Visualize alocação, disponibilidade e pontos de sobrecarga."
        action={<div className="capacity-actions"><button className="ghost" onClick={()=>fileRef.current?.click()} disabled={importing}>{importing?<I.LoaderCircle className="spin"/>:<I.FileSpreadsheet/>}{importing?"Importando...":"Importar Excel"}</button><input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={importCapacity}/><button className="primary" onClick={openNew}><I.UserPlus /> Novo colaborador</button></div>}
      />
      {importFeedback&&<div className="import-feedback"><I.CircleCheck/><span>{importFeedback}</span><button onClick={()=>setImportFeedback("")}><I.X/></button></div>}
      <div className="capacity-filter"><div><I.Boxes/><span><b>Capacidade por produto</b><small>Filtre os indicadores e colaboradores</small></span></div><select value={productFilter} onChange={(e)=>setProductFilter(e.target.value)}><option>Todos</option>{Array.from(new Set([...products.filter(product=>product.active).map(product=>product.name),...team.map(person=>person.product)])).filter(Boolean).map(name=><option key={name} value={name}>{name}</option>)}</select></div>
      <div className="kpis compact">
        <Card>
          <span>Capacidade total</span>
          <strong>{total}h</strong>
          <small>{filteredTeam.length} colaboradores</small>
        </Card>
        <Card>
          <span>Alocada</span>
          <strong>{used}h</strong>
          <small className="warn">
            {total ? Math.round((used / total) * 100) : 0}% utilizada
          </small>
        </Card>
        <Card>
          <span>Disponível</span>
          <strong className={free < 0 ? "bad" : ""}>{free}h</strong>
          <small className={free < 0 ? "bad" : "good"}>
            {free < 0 ? "Capacidade excedida" : "Reserva disponível"}
          </small>
        </Card>
        <Card>
          <span>Sobrecarregados</span>
          <strong>{overloaded}</strong>
          <small className={overloaded ? "bad" : "good"}>
            {overloaded ? "Requer atenção" : "Time equilibrado"}
          </small>
        </Card>
      </div>
      <Card>
        <div className="cardhead">
          <div>
            <h3>Alocação por colaborador</h3>
            <p>Capacidade planejada para setembro</p>
          </div>
          <Badge tone="gray">{filteredTeam.length} pessoas</Badge>
        </div>
        <div className="people">
          {filteredTeam.map((m) => {
            const allocated=effectiveUsed(m);
            const demandHours=allocatedDemandHours(m);
            const pct = Math.round((allocated / m.total) * 100);
            return (
              <div className="member member-managed" key={m.id}>
                <span className="avatar">
                  {m.name
                    .split(" ")
                    .map((x) => x[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <div>
                  <b>{m.name}</b>
                  <small>
                    {m.role} · {m.product}
                  </small>
                </div>
                <div className="usage">
                  <div className="usage-bar" role="button" tabIndex={0} title="Ver demandas alocadas" onClick={()=>setAllocationFor(m)} onKeyDown={(e)=>{if(e.key==="Enter")setAllocationFor(m)}}>
                    <i
                      className={pct > 90 ? "hot" : ""}
                      style={{ width: Math.min(pct, 100) + "%" }}
                    />
                  </div>
                  <small>
                    {allocated}h de {m.total}h · {pct}% alocado
                  </small>
                  <small>{demandHours}h provenientes das demandas</small>
                </div>
                <b className={pct > 90 ? "bad" : ""}>{pct}%</b>
                <span className={m.total - allocated < 0 ? "bad" : ""}>
                  {m.total - allocated}h livres
                </span>
                <div className="row-actions">
                  <button
                    title="Editar colaborador"
                    onClick={() => openEdit(m)}
                  >
                    <I.Pencil />
                  </button>
                  <button
                    className="delete"
                    title="Excluir colaborador"
                    onClick={() => setRemoving(m)}
                  >
                    <I.Trash2 />
                  </button>
                </div>
              </div>
            );
          })}
          {filteredTeam.length === 0 && (
            <div className="team-empty">
              <I.Users />
              <b>Nenhum colaborador cadastrado</b>
              <button className="primary" onClick={openNew}>
                Adicionar colaborador
              </button>
            </div>
          )}
        </div>
      </Card>
      {allocationFor&&<div className="overlay confirm-overlay" onMouseDown={()=>setAllocationFor(null)}><div className="capacity-demand-modal" onMouseDown={(e)=>e.stopPropagation()}><div className="modal-head"><div><span className="modal-icon"><I.ListTodo/></span><div><h2>Demandas alocadas</h2><p>{allocationFor.name} · {allocationFor.product}</p></div></div><button className="modal-close" onClick={()=>setAllocationFor(null)}><I.X/></button></div><div className="capacity-demand-list">{allocatedDemands.length===0?<div className="picker-empty"><I.CalendarX/><b>Nenhuma demanda alocada</b><span>Não existem alocações no Roadmap para este colaborador.</span></div>:allocatedDemands.map(({demand,plan,hours})=><div key={demand.id}><span className="demand-dot"/><div><b>{demand.name}</b><small>{demand.id} · {demand.product} · {plan.quarter}</small></div><Badge tone="blue">{hours}h</Badge></div>)}</div><div className="allocation-total"><span>Total nas demandas</span><b>{allocatedDemands.reduce((sum,item)=>sum+item.hours,0)}h</b></div><div className="picker-foot"><button className="primary" onClick={()=>setAllocationFor(null)}>Fechar</button></div></div></div>}
      {modal && (
        <div className="overlay confirm-overlay" onMouseDown={close}>
          <form
            className="staff-modal"
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={submit}
          >
            <div className="modal-head">
              <div>
                <span className="modal-icon">
                  {editing ? <I.UserRoundPen /> : <I.UserPlus />}
                </span>
                <div>
                  <h2>{editing ? "Editar colaborador" : "Novo colaborador"}</h2>
                  <p>Defina o perfil e a capacidade disponível no período.</p>
                </div>
              </div>
              <button type="button" className="modal-close" onClick={close}>
                <I.X />
              </button>
            </div>
            <div className="staff-form">
              <div className="form-field wide">
                <label>
                  Nome completo <em>*</em>
                </label>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ex.: Ana Oliveira"
                  className={error && !form.name ? "invalid" : ""}
                />
              </div>
              <div className="form-field wide">
                <label>Função</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                >
                  {form.role && !["Coordenador","Especialista DEV 1","Tech Lead","Backend","Frontend","Full Stack","UX Engineer","QA Engineer","Product Manager"].includes(form.role) && <option>{form.role}</option>}
                  <option>Coordenador</option>
                  <option>Especialista DEV 1</option>
                  <option>Tech Lead</option>
                  <option>Backend</option>
                  <option>Frontend</option>
                  <option>Full Stack</option>
                  <option>UX Engineer</option>
                  <option>QA Engineer</option>
                  <option>Product Manager</option>
                </select>
              </div>
              <div className="form-field wide">
                <label>
                  Produto <em>*</em>
                </label>
                <select
                  value={form.product}
                  onChange={(e) =>
                    setForm({ ...form, product: e.target.value })
                  }
                >
                  <option value="">Selecione um produto...</option>
                  {products
                    .filter((product) => product.active)
                    .map((product) => (
                      <option key={product.id} value={product.name}>
                        {product.name}
                      </option>
                    ))}
                  {form.product && !products.some(product => product.name === form.product && product.active) && <option value={form.product}>{form.product} (planilha)</option>}
                </select>
              </div>
              <div className="form-field">
                <label>Capacidade (horas)</label>
                <input
                  type="number"
                  min="1"
                  value={form.total}
                  onChange={(e) => setForm({ ...form, total: e.target.value })}
                />
              </div>
              <div className="form-field">
                <label>Horas alocadas</label>
                <input
                  type="number"
                  min="0"
                  value={form.used}
                  onChange={(e) => setForm({ ...form, used: e.target.value })}
                />
              </div>
              {error && (
                <div className="staff-error">
                  <I.CircleAlert />
                  {error}
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={close}>
                Cancelar
              </button>
              <button className="primary" type="submit">
                {editing ? <I.Save /> : <I.UserPlus />}
                {editing ? "Salvar alterações" : "Adicionar colaborador"}
              </button>
            </div>
          </form>
        </div>
      )}
      {removing && (
        <div
          className="overlay confirm-overlay"
          onMouseDown={() => setRemoving(null)}
        >
          <div
            className="confirm-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <span>
              <I.UserRoundX />
            </span>
            <h3>Excluir colaborador?</h3>
            <p>
              <b>{removing.name}</b> será removido do planejamento de
              capacidade. Esta ação não poderá ser desfeita.
            </p>
            <div>
              <button className="ghost" onClick={() => setRemoving(null)}>
                Cancelar
              </button>
              <button className="danger" onClick={confirmRemove}>
                <I.Trash2 /> Excluir colaborador
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Planning() {
  const { rows, roadmap } = useDemands();
  const { products } = useProducts();
  const [productFilter, setProductFilter] = useState("Todos");
  const [quarterFilter, setQuarterFilter] = useState("Todos");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const quarterByDemand = new Map(roadmap.map(entry => [entry.demandId, entry.quarter]));
  const quarterFor = (demand: Demand) => quarterByDemand.get(demand.id) || "Sem quarter";
  const productOptions = Array.from(new Set([...products.map(product => product.name), ...rows.map(demand => demand.product)])).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const quarterOptions = Array.from(new Set([...quarters, ...roadmap.map(entry => entry.quarter)])).sort((a, b) => a.slice(3).localeCompare(b.slice(3)) || a.localeCompare(b));
  const statusOptions = Array.from(new Set(rows.map(demand => demand.status))).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const filtered = rows.filter(demand =>
    (productFilter === "Todos" || demand.product === productFilter) &&
    (quarterFilter === "Todos" || quarterFor(demand) === quarterFilter) &&
    (statusFilter === "Todos" || demand.status === statusFilter)
  );
  const hasFilters = productFilter !== "Todos" || quarterFilter !== "Todos" || statusFilter !== "Todos";
  return <>
    <PageHead title="Planejamento" desc="Acompanhe as demandas por produto, quarter e status." />
    <div className="planning-filters">
      <label>Produto<select value={productFilter} onChange={event => setProductFilter(event.target.value)}><option value="Todos">Todos os produtos</option>{productOptions.map(product => <option key={product}>{product}</option>)}</select></label>
      <label>Quarter<select value={quarterFilter} onChange={event => setQuarterFilter(event.target.value)}><option value="Todos">Todos os quarters</option><option>Sem quarter</option>{quarterOptions.map(quarter => <option key={quarter}>{quarter}</option>)}</select></label>
      <label>Status<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="Todos">Todos os status</option>{statusOptions.map(status => <option key={status}>{status}</option>)}</select></label>
      {hasFilters && <button className="ghost" onClick={() => { setProductFilter("Todos"); setQuarterFilter("Todos"); setStatusFilter("Todos"); }}><I.X /> Limpar filtros</button>}
      <span role="status">{filtered.length} de {rows.length} demandas</span>
    </div>
    {filtered.length ? <div className="planning-cards">
      {filtered.map(demand => {
        const progress = Math.min(100, Math.max(0, demand.progress || 0));
        const completed = ["Concluído", "Concluída"].includes(demand.status) || progress === 100;
        const due = demand.dueDate ? new Date(`${demand.dueDate}T12:00:00`).toLocaleDateString("pt-BR") : demand.due || "Sem prazo";
        return <article className="planning-demand-card" key={demand.id}>
          <div className="planning-card-top"><span>{demand.id}</span><Badge tone={completed ? "good" : demand.status === "Bloqueada" ? "bad" : "blue"}>{demand.status}</Badge></div>
          <h3>{demand.name}</h3>
          <div className="planning-card-tags"><span><I.Boxes aria-hidden="true" />{demand.product}</span><span><I.CalendarRange aria-hidden="true" />{quarterFor(demand)}</span></div>
          <dl>
            <div><dt>Responsável</dt><dd>{demand.owner || "Não informado"}</dd></div>
            <div><dt>Prioridade</dt><dd>{demand.priority}</dd></div>
            <div><dt>Prazo</dt><dd>{due}</dd></div>
            <div><dt>Esforço estimado</dt><dd>{demand.effort}h</dd></div>
          </dl>
          <div className="planning-card-progress"><span>Evolução <b>{progress}%</b></span><progress max="100" value={progress} aria-label={`Evolução de ${demand.name}`} /></div>
        </article>;
      })}
    </div> : <Card><div className="planning-empty"><I.ListTodo aria-hidden="true" /><b>{rows.length ? "Nenhuma demanda encontrada" : "Nenhuma demanda cadastrada"}</b><p>{rows.length ? "Altere ou limpe os filtros para visualizar outras demandas." : "Cadastre demandas na Gestão de demandas para acompanhar o planejamento."}</p></div></Card>}
  </>;
}
function Risks() {
  return (
    <>
      <PageHead
        title="Mapa de riscos"
        desc="Antecipe ameaças e acompanhe os planos de mitigação."
        action={
          <button className="primary">
            <I.Plus /> Novo risco
          </button>
        }
      />
      <div className="riskgrid">
        <Card>
          <div className="cardhead">
            <div>
              <h3>Matriz de probabilidade × impacto</h3>
              <p>Clique em uma célula para filtrar</p>
            </div>
          </div>
          <div className="matrix">
            <span />
            <b>Baixo</b>
            <b>Médio</b>
            <b>Alto</b>
            <b>Crítico</b>
            {["Alta", "Média", "Baixa"].map((r, ri) => (
              <React.Fragment key={r}>
                <b>{r}</b>
                {[0, 1, 2, 3].map((_, ci) => (
                  <div className={"cell c" + Math.min(3, ci + (2 - ri))}>
                    {ri === 0 && ci === 2 ? (
                      <i>2</i>
                    ) : ri === 1 && ci === 3 ? (
                      <i>1</i>
                    ) : (
                      ""
                    )}
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>
        </Card>
        <Card>
          <div className="cardhead">
            <div>
              <h3>Riscos prioritários</h3>
              <p>Ordenados por exposição</p>
            </div>
          </div>
          {[
            "Dependência da API antifraude",
            "Capacidade de backend em setembro",
            "Prazo regulatório inegociável",
          ].map((x, i) => (
            <div className="riskitem">
              <span className={"risknum r" + i}>{i + 1}</span>
              <div>
                <b>{x}</b>
                <small>
                  {
                    [
                      "DEV-148 · Rafael Lima",
                      "Time Backend · Marina Costa",
                      "DEV-154 · Lucas Rocha",
                    ][i]
                  }
                </small>
              </div>
              <Badge tone={i === 2 ? "bad" : "warn"}>
                {i === 2 ? "Crítico" : "Alto"}
              </Badge>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}

function LegacyChanges() {
  return (
    <>
      <PageHead
        title="Mudanças do roadmap"
        desc="Rastreabilidade completa das decisões que alteraram o trimestre."
        action={
          <button className="primary">
            <I.Plus /> Registrar mudança
          </button>
        }
      />
      <Card>
        {[
          [
            "Hoje, 14:32",
            "DEV-154 adicionada ao trimestre",
            "Vagner Moraes",
            "+60h · impacto alto",
          ],
          [
            "Ontem, 16:10",
            "Prioridade do checkout alterada",
            "Marina Costa",
            "Alta → Crítica",
          ],
          [
            "29 Ago, 10:24",
            "Esforço do Portal revisado",
            "Camila Souza",
            "120h → 140h",
          ],
          [
            "27 Ago, 09:05",
            "Otimização de busca concluída",
            "Bruno Alves",
            "Entrega antecipada",
          ],
        ].map((x, i) => (
          <div className="change">
            <div className={"changeicon i" + i}>
              {i === 0 ? (
                <I.Plus />
              ) : i === 1 ? (
                <I.ArrowUp />
              ) : i === 2 ? (
                <I.Clock />
              ) : (
                <I.Check />
              )}
            </div>
            <div>
              <small>{x[0]}</small>
              <b>{x[1]}</b>
              <span>por {x[2]}</span>
            </div>
            <Badge tone={i === 0 ? "bad" : i === 3 ? "good" : "gray"}>
              {x[3]}
            </Badge>
          </div>
        ))}
      </Card>
    </>
  );
}
function RoadmapComparison(){
  const {rows,roadmap,versions}=useDemands();
  const versionedQuarters=Array.from(new Set(versions.map((item)=>item.quarter)));
  const [quarter,setQuarter]=useState(versionedQuarters[0]||"Q3 2026");
  const quarterVersions=versions.filter((item)=>item.quarter===quarter).sort((a,b)=>a.version-b.version);
  const baseline=quarterVersions[0];
  const currentEntries=roadmap.filter((item)=>item.quarter===quarter);
  const initialIds=new Set(baseline?.entries.map((item)=>item.demandId)||[]);
  const currentIds=new Set(currentEntries.map((item)=>item.demandId));
  const comparison=Array.from(new Set([...initialIds,...currentIds])).map((id)=>{
    const initialEntry=baseline?.entries.find((item)=>item.demandId===id);
    const currentEntry=currentEntries.find((item)=>item.demandId===id);
    const demand=rows.find((item)=>item.id===id)||baseline?.demands.find((item)=>item.id===id);
    const status=!initialEntry?"Adicionada":!currentEntry?"Removida":JSON.stringify(initialEntry.allocations)!==JSON.stringify(currentEntry.allocations)?"Ajustada":"Mantida";
    return {id,demand,initialEntry,currentEntry,status};
  });
  return <><PageHead title="Comparação do Roadmap" desc="Compare o primeiro planejamento preservado com a versão atualmente em execução."/>
    <div className="changes-filters"><div><I.GitCompareArrows/><span><b>Baseline versus execução</b><small>{baseline?`V${baseline.version} criada em ${baseline.createdAt}`:"Crie a primeira versão no Roadmap"}</small></span></div><label>Quarter<select value={quarter} onChange={(e)=>setQuarter(e.target.value)}>{(versionedQuarters.length?versionedQuarters:quarters).map((item)=><option key={item}>{item}</option>)}</select></label></div>
    {!baseline?<Card><div className="changes-empty"><I.History/><b>Nenhuma versão inicial registrada</b><span>Acesse o Roadmap trimestral e clique em “Criar versão” para preservar o primeiro planejamento.</span></div></Card>:<><div className="kpis compact"><Card><span>Versão inicial</span><strong>V{baseline.version}</strong><small>{baseline.entries.length} demandas</small></Card><Card><span>Em execução</span><strong>{currentEntries.length}</strong><small>demandas atuais</small></Card><Card><span>Novas demandas</span><strong>{comparison.filter((item)=>item.status==="Adicionada").length}</strong><small>após o planejamento</small></Card><Card><span>Removidas/ajustadas</span><strong>{comparison.filter((item)=>["Removida","Ajustada"].includes(item.status)).length}</strong><small>mudanças identificadas</small></Card></div><Card><div className="tablewrap"><table><thead><tr><th>Demanda</th><th>Produto</th><th>Versão inicial</th><th>Em execução</th><th>Comparação</th></tr></thead><tbody>{comparison.map((item)=><tr key={item.id}><td><b>{item.demand?.name||item.id}</b><small>{item.id}</small></td><td>{item.demand?.product||"—"}</td><td>{item.initialEntry?`${item.initialEntry.allocations.reduce((sum,a)=>sum+a.hours,0)}h alocadas`:"Não constava"}</td><td>{item.currentEntry?`${item.currentEntry.allocations.reduce((sum,a)=>sum+a.hours,0)}h alocadas`:"Removida"}</td><td><Badge tone={item.status==="Adicionada"?"good":item.status==="Removida"?"bad":item.status==="Ajustada"?"warn":"gray"}>{item.status}</Badge></td></tr>)}</tbody></table></div></Card></>}
  </>;
}

function Changes(){
  const {history,rows,versions}=useDemands();
  const {products}=useProducts();
  const [product,setProduct]=useState("Todos");
  const [quarter,setQuarter]=useState("Todos");
  const [selectedVersion,setSelectedVersion]=useState<RoadmapVersion|null>(null);
  const filtered=history.filter((item)=>(product==="Todos"||item.product===product)&&(quarter==="Todos"||item.quarter===quarter));
  const versionFromLog=(item:ChangeLog)=>{const number=Number(item.title.match(/Versão V(\d+)/)?.[1]);return number?versions.find((version)=>version.version===number&&(!item.quarter||version.quarter===item.quarter)):undefined};
  return <><PageHead title="Auditoria do Roadmap" desc="Histórico automático de versões, inclusões, movimentações, remoções e alocações."/><div className="changes-filters"><div><I.Filter/><span><b>Filtrar auditoria</b><small>{filtered.length} de {history.length} alterações</small></span></div><label>Produto<select value={product} onChange={(e)=>setProduct(e.target.value)}><option>Todos</option>{products.map((item)=><option key={item.id} value={item.name}>{item.name}</option>)}</select></label><label>Quarter<select value={quarter} onChange={(e)=>setQuarter(e.target.value)}><option value="Todos">Quarter</option>{quarters.map((item)=><option key={item}>{item}</option>)}</select></label>{(product!=="Todos"||quarter!=="Todos")&&<button onClick={()=>{setProduct("Todos");setQuarter("Todos")}}><I.X/> Limpar</button>}</div><Card>{filtered.length===0?<div className="changes-empty"><I.History/><b>Nenhuma alteração encontrada</b><span>{history.length?"Altere ou limpe os filtros para visualizar outros registros.":"As ações realizadas no Roadmap aparecerão automaticamente aqui."}</span></div>:filtered.map((item)=>{const storedVersion=versionFromLog(item);return <div className="change" key={item.id}><div className={`changeicon log-${item.tone}`}>{item.tone==="good"?<I.Plus/>:item.tone==="bad"?<I.Trash2/>:item.tone==="warn"?<I.ArrowRightLeft/>:<I.Users/>}</div><div><small>{item.date}</small>{storedVersion?<button className="audit-version-button" onClick={()=>setSelectedVersion(storedVersion)}>{item.title}<I.ExternalLink/></button>:<b>{item.title}</b>}<span>por {item.actor}{item.product?` · ${item.product}`:""}{item.quarter?` · ${item.quarter}`:""}</span>{(item.demandId||item.demandName)&&<span className="change-demand"><I.ListTodo/> Demanda: <b>{item.demandName||rows.find((d)=>d.id===item.demandId)?.name||item.demandId}</b>{item.demandId&&` (${item.demandId})`}</span>}</div><Badge tone={item.tone}>{item.detail}</Badge></div>})}</Card>
  {selectedVersion&&<div className="overlay confirm-overlay" onMouseDown={()=>setSelectedVersion(null)}><div className="version-detail-modal" onMouseDown={(e)=>e.stopPropagation()}><div className="modal-head"><div><span className="modal-icon"><I.History/></span><div><h2>Roadmap V{selectedVersion.version}</h2><p>{selectedVersion.quarter} · armazenada em {selectedVersion.createdAt}</p></div></div><button className="modal-close" onClick={()=>setSelectedVersion(null)}><I.X/></button></div><div className="version-demand-list">{selectedVersion.entries.length===0?<div className="picker-empty"><I.CalendarX/><b>Versão sem demandas</b></div>:selectedVersion.entries.map((entry)=>{const demand=selectedVersion.demands.find((item)=>item.id===entry.demandId);return <div key={entry.demandId}><span className="demand-dot"/><div><b>{demand?.name||entry.demandId}</b><small>{entry.demandId} · {demand?.product||"Produto não disponível"} · {demand?.status||"Status não disponível"}</small></div><Badge tone="blue">{entry.allocations.reduce((sum,item)=>sum+item.hours,0)}h</Badge></div>})}</div><div className="allocation-total"><span>Total da versão</span><b>{selectedVersion.entries.length} demanda(s) · {selectedVersion.entries.reduce((sum,entry)=>sum+entry.allocations.reduce((hours,item)=>hours+item.hours,0),0)}h</b></div><div className="picker-foot"><button className="primary" onClick={()=>setSelectedVersion(null)}>Fechar</button></div></div></div>}</>;
}
function Analytics() {
  const { rows, roadmap } = useDemands();
  const { team } = useTeam();
  const { products } = useProducts();
  const [productFilter, setProductFilter] = useState("Todos");
  const [quarterFilter, setQuarterFilter] = useState("Todos");
  const [billingFilter, setBillingFilter] = useState("Todos");
  const isBilled = (demand: Demand) => (demand.billedAmount ?? 0) > 0;
  const completed = rows.filter(demand => ["Concluído", "Concluída"].includes(demand.status) || demand.progress === 100);
  const quarterFor = (demand: Demand) => {
    const planned = roadmap.find(entry => entry.demandId === demand.id)?.quarter;
    if (planned) return planned;
    const match = demand.dueDate?.match(/^(\d{4})-(\d{2})-\d{2}$/);
    return match ? `Q${Math.ceil(Number(match[2]) / 3)} ${match[1]}` : "Sem quarter";
  };
  const productOptions = Array.from(new Set([...products.map(product => product.name), ...completed.map(demand => demand.product)]));
  const quarterOptions = Array.from(new Set(completed.map(quarterFor))).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const filtered = completed.filter(demand => (productFilter === "Todos" || demand.product === productFilter) && (quarterFilter === "Todos" || quarterFor(demand) === quarterFilter) && (billingFilter === "Todos" || isBilled(demand) === (billingFilter === "Faturadas")));
  const allocatedByRole = (demand: Demand, roles: string[]) => {
    const allocations = roadmap.find(entry => entry.demandId === demand.id)?.allocations || [];
    const linkedIds = demand.resourceIds || [];
    if (!allocations.length && !linkedIds.length) return null;
    const explicitTotal = allocations.reduce((sum, item) => sum + item.hours, 0);
    const implicitIds = linkedIds.filter(id => !allocations.some(item => item.staffId === id));
    const implicitHours = implicitIds.length ? Math.round(Math.max(0, demand.effort - explicitTotal) / implicitIds.length) : 0;
    return team.reduce((sum, person) => {
      if (!roles.includes(person.role.trim().toUpperCase())) return sum;
      return sum + (allocations.find(item => item.staffId === person.id)?.hours ?? (implicitIds.includes(person.id) ? implicitHours : 0));
    }, 0);
  };
  return <>
    <PageHead title="Analytics" desc="Demandas concluídas e capacidade alocada por função." />
    <div className="analytics-filters">
      <label>Produto<select value={productFilter} onChange={event => setProductFilter(event.target.value)}><option>Todos</option>{productOptions.map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Quarter<select value={quarterFilter} onChange={event => setQuarterFilter(event.target.value)}><option>Todos</option>{quarterOptions.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Faturamento<select value={billingFilter} onChange={event => setBillingFilter(event.target.value)}><option>Todos</option><option>Faturadas</option><option>Não faturadas</option></select></label>
      <span>{filtered.length} de {completed.length} demandas concluídas</span>
    </div>
    <Card><div className="tablewrap"><table className="analytics-table"><thead><tr><th>Demanda</th><th>Capacidade de Desenvolvimento</th><th>Capacidade de Testes</th><th>Prazo</th><th>Responsável</th><th>Faturada</th><th>Valor faturado</th></tr></thead><tbody>{filtered.map(demand => {
      const development = allocatedByRole(demand, ["DEV", "BACKEND", "FRONTEND", "FULL STACK"]);
      const tests = allocatedByRole(demand, ["QA", "QA ENGINEER"]);
      const due = demand.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(demand.dueDate) ? new Date(`${demand.dueDate}T12:00:00`).toLocaleDateString("pt-BR") : demand.due || "Sem prazo";
      return <tr key={demand.id}><td><b>{demand.name}</b><small>{demand.id} · {demand.product} · {quarterFor(demand)}</small></td><td>{development === null ? "—" : `${development}h`}</td><td>{tests === null ? "—" : `${tests}h`}</td><td>{due}</td><td>{demand.owner || "Não informado"}</td><td><Badge tone={isBilled(demand) ? "good" : "neutral"}>{isBilled(demand) ? "Sim" : "Não"}</Badge></td><td>{(demand.billedAmount ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td></tr>;
    })}</tbody></table>{filtered.length === 0 && <div className="analytics-empty">Nenhuma demanda concluída encontrada para os filtros selecionados.</div>}</div></Card>
  </>;
}

function Reports() {
  return (
    <>
      <PageHead
        title="Relatórios"
        desc="Transforme dados do trimestre em decisões compartilháveis."
        action={
          <button className="primary">
            <I.Download /> Exportar relatório
          </button>
        }
      />
      <div className="reportgrid">
        {[
          [
            "Evolução do roadmap",
            "Progresso planejado versus realizado",
            I.TrendingUp,
          ],
          [
            "Capacidade e utilização",
            "Alocação por time, pessoa e período",
            I.Gauge,
          ],
          [
            "Mudanças do trimestre",
            "Inclusões, remoções e impacto acumulado",
            I.GitCompareArrows,
          ],
          [
            "Riscos e previsibilidade",
            "Exposição e tendência das entregas",
            I.ShieldCheck,
          ],
        ].map(([a, b, Icon]: any) => (
          <Card className="report">
            <span>
              <Icon />
            </span>
            <div>
              <h3>{a}</h3>
              <p>{b}</p>
            </div>
            <button className="icon">
              <I.ArrowUpRight />
            </button>
          </Card>
        ))}
      </div>
    </>
  );
}
function Settings() {
  return (
    <>
      <PageHead
        title="Configurações"
        desc="Personalize o workspace, times e regras de planejamento."
      />
      <Card>
        <div className="settings">
          <div>
            <h3>Preferências do planejamento</h3>
            <p>Defina limites e comportamentos padrão.</p>
          </div>
          <label>
            Limite de ocupação recomendado{" "}
            <select>
              <option>85%</option>
              <option>90%</option>
            </select>
          </label>
          <label>
            Reserva técnica mínima{" "}
            <select>
              <option>10%</option>
              <option>15%</option>
            </select>
          </label>
          <label className="switchrow">
            <span>
              <b>Alertas de capacidade</b>
              <small>Notificar quando um time exceder o limite</small>
            </span>
            <input type="checkbox" defaultChecked />
          </label>
          <button className="primary">Salvar alterações</button>
        </div>
      </Card>
    </>
  );
}

function UsersAdmin({users, currentId, onChange}:{users:Account[];currentId:string;onChange:(users:Account[])=>void}) {
  const { products } = useProducts();
  const [name,setName]=useState(""); const [email,setEmail]=useState(""); const [password,setPassword]=useState("");
  const [role,setRole]=useState<AccessRole>("Editor"); const [selectedProducts,setSelectedProducts]=useState<number[]>([]); const [error,setError]=useState("");
  const allIds=products.map(product=>product.id);
  const toggle=(ids:number[],id:number)=>ids.includes(id)?ids.filter(value=>value!==id):[...ids,id];
  async function add(e:React.FormEvent) {
    e.preventDefault(); setError("");
    if(password.length<8){setError("A senha deve ter pelo menos 8 caracteres.");return}
    if(users.some(user=>user.email===email.trim().toLowerCase())){setError("Este e-mail já está cadastrado.");return}
    if(role!=="Administrador" && selectedProducts.length===0){setError("Selecione ao menos um produto para o usuário.");return}
    try {const account=await makeAccount(name,email,password,role);onChange([...users,{...account,productIds:role==="Administrador"?allIds:selectedProducts}]);setName("");setEmail("");setPassword("");setSelectedProducts([])}
    catch {setError("Não foi possível salvar o usuário.")}
  }
  function changeRole(user:Account,next:AccessRole){if(user.email===ADMIN_EMAIL || user.id===currentId && next!=="Administrador")return;onChange(users.map(item=>item.id===user.id?{...item,role:next,productIds:next==="Administrador"?allIds:item.productIds??allIds}:item))}
  function changeProducts(user:Account,id:number){if(user.role==="Administrador")return;const next=toggle(user.productIds??allIds,id);onChange(users.map(item=>item.id===user.id?{...item,productIds:next}:item))}
  function remove(user:Account){if(user.id===currentId || user.email===ADMIN_EMAIL)return;onChange(users.filter(item=>item.id!==user.id))}
  return <><PageHead title="Administração de usuários" desc="Defina o perfil e os produtos que cada usuário pode acessar."/>
    <Card><form className="account-form" onSubmit={add}>
      <label>Nome<input required value={name} onChange={event=>setName(event.target.value)}/></label>
      <label>E-mail<input required type="email" value={email} onChange={event=>setEmail(event.target.value)}/></label>
      <label>Senha inicial<input required type="password" minLength={8} value={password} onChange={event=>setPassword(event.target.value)}/></label>
      <label>Perfil<select value={role} onChange={event=>setRole(event.target.value as AccessRole)}><option>Administrador</option><option>Editor</option><option>Visualização</option></select></label>
      {role!=="Administrador"&&<fieldset className="user-product-options"><legend>Produtos permitidos</legend>{products.map(product=><label key={product.id}><input type="checkbox" checked={selectedProducts.includes(product.id)} onChange={()=>setSelectedProducts(toggle(selectedProducts,product.id))}/>{product.name}</label>)}</fieldset>}
      <button className="primary" type="submit"><I.UserPlus/> Criar usuário</button>
    </form>{error&&<p className="auth-error" role="alert">{error}</p>}</Card>
    <Card><div className="tablewrap"><table><thead><tr><th>Usuário</th><th>E-mail</th><th>Perfil</th><th>Produtos permitidos</th><th>Último acesso</th><th></th></tr></thead><tbody>{users.map(user=><tr key={user.id}>
      <td><span className="person">{user.name[0]}</span><b>{user.name}</b></td><td>{user.email}</td>
      <td><select className="quarter-inline" value={user.role} disabled={user.id===currentId||user.email===ADMIN_EMAIL} onChange={event=>changeRole(user,event.target.value as AccessRole)}><option>Administrador</option><option>Editor</option><option>Visualização</option></select></td>
      <td>{user.role==="Administrador"?"Todos os produtos":<div className="user-product-options compact">{products.map(product=><label key={product.id}><input type="checkbox" checked={(user.productIds??allIds).includes(product.id)} onChange={()=>changeProducts(user,product.id)}/>{product.name}</label>)}</div>}</td>
      <td>{user.lastAccessAt && Number.isFinite(Date.parse(user.lastAccessAt)) ? <time dateTime={user.lastAccessAt}>{new Date(user.lastAccessAt).toLocaleString("pt-BR")}</time> : "Sem registro"}</td>
      <td>{user.id!==currentId&&user.email!==ADMIN_EMAIL&&<button className="ghost" onClick={()=>remove(user)} aria-label={`Excluir ${user.name}`}><I.Trash2/></button>}</td>
    </tr>)}</tbody></table></div></Card>
  </>;
}

function Login({hasAccounts,onLogin}:{hasAccounts:boolean;onLogin:(account:Account,remember:boolean,accounts?:Account[])=>void}) {
  const [name,setName]=useState("");const [email,setEmail]=useState("");const [password,setPassword]=useState("");const [remember,setRemember]=useState(false);const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");try {if(!hasAccounts){if(password.length<8){setError("Use uma senha com pelo menos 8 caracteres.");return}const account=await makeAccount(name,email,password,"Administrador");onLogin(account,remember,[account]);return}const account=loadAccounts().find(u=>u.email===email.trim().toLowerCase());if(!account || await hashPassword(password,account.salt)!==account.passwordHash){setError("E-mail ou senha inválidos.");return}onLogin(account,remember)}catch{setError("Não foi possível autenticar. Verifique o armazenamento do navegador.")}finally{setBusy(false)}}
  return <div className="login-screen"><form className="login-card" onSubmit={submit}><div className="login-mark"><I.Waypoints/></div><h1>{hasAccounts?"Entrar no nddPlan":"Criar administrador"}</h1><p>{hasAccounts?"Acesse com seu e-mail e senha.":"Configure o primeiro acesso deste navegador."}</p>{!hasAccounts&&<label>Nome<input required autoComplete="name" value={name} onChange={e=>setName(e.target.value)}/></label>}<label>E-mail<input required type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Senha<input required type="password" minLength={hasAccounts?1:8} autoComplete={hasAccounts?"current-password":"new-password"} value={password} onChange={e=>setPassword(e.target.value)}/></label><label className="remember-login"><input type="checkbox" checked={remember} onChange={event=>setRemember(event.target.checked)}/><span>Manter conectado neste navegador</span></label>{error&&<p className="auth-error" role="alert">{error}</p>}<button className="primary" disabled={busy} type="submit">{busy?"Aguarde...":hasAccounts?"Entrar":"Criar conta e entrar"}</button><small>Os usuários e dados deste protótipo ficam armazenados neste navegador.</small></form></div>
}

function App() {
  const productCatalog = useContext(ProductContext);
  const [accounts,setAccounts]=useState<Account[]>(loadAccounts);
  const [activeId,setActiveId]=useState<string|null>(sessionId);
  const activeUser=accounts.find(u=>u.id===activeId);
  const [page, setPage] = useState<Page>("Visão geral");
  const [dark, setDark] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [cmd, setCmd] = useState(false);
  const role=activeUser?.role ?? "Visualização";
  function updateAccounts(next:Account[]){saveAccounts(next);setAccounts(next)}
  function login(account:Account,remember:boolean,next?:Account[]){const lastAccessAt=new Date().toISOString();updateAccounts((next??loadAccounts()).map(user=>user.id===account.id?{...user,lastAccessAt}:user));setSession(account.id,remember);setActiveId(account.id)}
  function logout(){setSession(null);setActiveId(null);setCmd(false)}
  const allowedNav=nav.filter(([name])=>role==="Administrador"?true:role==="Editor"?["Visão geral","Demandas","Roadmap","Comparação","Produtos","Capacidade","Analytics"].includes(name):["Demandas","Roadmap","Comparação","Capacidade","Analytics"].includes(name));
  useEffect(()=>{if(!allowedNav.some(([name])=>name===page))setPage(role==="Visualização"?"Demandas":"Visão geral")},[role]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setCmd(true);
      }
    };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  }, []);
  if(!activeUser)return <Login hasAccounts={accounts.length>0} onLogin={login}/>;
  return (
    <ProductAccessContext.Provider value={role === "Administrador" ? null : new Set(activeUser.productIds ?? productCatalog?.products.map(product => product.id) ?? [])}>
    <div className={`${dark ? "app dark" : "app"} ${role === "Visualização" ? "role-viewer" : role === "Editor" ? "role-editor" : "role-admin"}`}>
      <aside className={collapsed ? "collapsed" : ""}>
        <div className="brand">
          <span>
            <I.Waypoints />
          </span>
          <b>
            ndd<span>Plan</span>
          </b>
          <button onClick={() => setCollapsed(!collapsed)}>
            <I.PanelLeftClose />
          </button>
        </div>
        <nav>
          {allowedNav.map(([n, Icon]) => (
            <button
              title={n}
              className={page === n ? "active" : ""}
              onClick={() => setPage(n)}
            >
              <Icon />
              <span>{n}</span>
            </button>
          ))}
        </nav>
        <div className="sidefoot">
          <div className="workspace">
            <span>AX</span>
            <div>
              <b>Atlas Digital</b>
              <small>Workspace enterprise</small>
            </div>
            <I.ChevronsUpDown />
          </div>
        </div>
      </aside>
      <main>
        <header>
          <button className="mobile" onClick={() => setCollapsed(!collapsed)}>
            <I.Menu />
          </button>
          <button className="topsearch" onClick={() => setCmd(true)}>
            <I.Search />
            <span>Buscar demandas, projetos, pessoas...</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="topactions">
            <button onClick={() => setDark(!dark)}>
              {dark ? <I.Sun /> : <I.Moon />}
            </button>
            <button className="bell">
              <I.Bell />
              <i />
            </button>
            <div className="user">
              <span>{activeUser.name.split(" ").map(part=>part[0]).slice(0,2).join("").toUpperCase()}</span>
              <div>
                <b>{activeUser.name}</b>
                <small>{role}</small>
              </div>
              <button className="logout-button" onClick={logout} title="Sair" aria-label="Sair"><I.LogOut/></button>
            </div>
          </div>
        </header>
        <div className="content">
          {page === "Visão geral" ? (
            <Dashboard go={setPage} />
          ) : page === "Roadmap" ? (
            <Roadmap />
          ) : page === "Comparação" ? (
            <RoadmapComparison />
          ) : page === "Demandas" ? (
            <Demands />
          ) : page === "Produtos" ? (
            <Products />
          ) : page === "Capacidade" ? (
            <Capacity />
          ) : page === "Planejamento" ? (
            <Planning />
          ) : page === "Auditoria" ? (
            <Changes />
          ) : page === "Relatórios" ? (
            <Reports />
          ) : page === "Analytics" ? (
            <Analytics />
          ) : page === "Usuários" ? (
            <UsersAdmin users={accounts} currentId={activeUser.id} onChange={updateAccounts}/>
          ) : (
            <Settings />
          )}
        </div>
      </main>
      {cmd && (
        <div className="overlay" onMouseDown={() => setCmd(false)}>
          <div className="command" onMouseDown={(e) => e.stopPropagation()}>
            <label>
              <I.Search />
              <input autoFocus placeholder="O que você procura?" />
            </label>
            <small>NAVEGAÇÃO</small>
            {allowedNav.map(([n, Icon]) => (
              <button
                onClick={() => {
                  setPage(n);
                  setCmd(false);
                }}
              >
                <Icon />
                {n}
                <I.ArrowRight />
              </button>
            ))}
            <footer>
              <span>↑↓ para navegar</span>
              <span>ESC para fechar</span>
            </footer>
          </div>
        </div>
      )}
    </div>
    </ProductAccessContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(
  <ProductProvider>
    <TeamProvider>
      <DemandProvider>
        <App />
      </DemandProvider>
    </TeamProvider>
  </ProductProvider>,
);
