"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const PALETTE = ["#8b5cf6", "#a07cff", "#60a5fa", "#34d399", "#fbbf24", "#f87171", "#bda6ff", "#5426aa"];
const tooltipStyle = { background: "#18181f", border: "1px solid #353343", borderRadius: 12, color: "#f5f4fa", fontSize: 12 };

export function SalesChart({ data }: { data: { bucket: string; sales: number; profit: number; placedOrders: number; paidOrders: number }[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
          <defs>
            <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.45} /><stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} /></linearGradient>
            <linearGradient id="gProfit" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34d399" stopOpacity={0.3} /><stop offset="100%" stopColor="#34d399" stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid stroke="#262531" vertical={false} />
          <XAxis dataKey="bucket" tick={{ fill: "#75728a", fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis tick={{ fill: "#75728a", fontSize: 11 }} tickFormatter={money} axisLine={false} tickLine={false} width={56} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [money(Number(v)), name === "sales" ? "Sales (after discounts)" : "Gross profit"]} />
          <Area type="monotone" dataKey="sales" stroke="#a07cff" strokeWidth={2} fill="url(#gSales)" />
          <Area type="monotone" dataKey="profit" stroke="#34d399" strokeWidth={1.5} fill="url(#gProfit)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function OrdersChart({ data }: { data: { bucket: string; placedOrders: number; paidOrders: number }[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
          <CartesianGrid stroke="#262531" vertical={false} />
          <XAxis dataKey="bucket" tick={{ fill: "#75728a", fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis allowDecimals={false} tick={{ fill: "#75728a", fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [v, name === "placedOrders" ? "Orders placed" : "Orders paid"]} cursor={{ fill: "rgba(139,92,246,0.08)" }} />
          <Bar dataKey="placedOrders" fill="#5426aa" radius={[4, 4, 0, 0]} />
          <Bar dataKey="paidOrders" fill="#a07cff" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BreakdownChart({ data }: { data: { name: string; amount: number }[] }) {
  if (!data.length) return <p className="py-10 text-center text-sm text-subtle">No data for this period yet.</p>;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="h-44 w-44 shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="amount" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={2} stroke="none">
              {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(Number(v))} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full space-y-1.5 text-sm">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-muted"><span className="size-2.5 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />{d.name}</span>
            <span className="font-semibold text-white">{money(d.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
