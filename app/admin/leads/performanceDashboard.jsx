// components/admin/PerformanceDashboard.jsx
import { useFetchQuery } from "@/hooks/use-query";
import { performance } from "@/server/leadServer";
import {
  BarChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  Bar,
} from "recharts";

export default function PerformanceDashboard() {
  const { data: performanceData } = useFetchQuery({
    fetchFn: performance,
    queryKey: ["leadPerformance"],
  });
  const { newData: data = {} } = performanceData || {};

  const conversionRate = ((data.qualified / data.total) * 100).toFixed(1);
  const lostRate = ((data.lost / data.total) * 100).toFixed(1);
  const qualifiedRate = ((data.qualified / data.total) * 100).toFixed(1);
  const qualifiedVsLostRate = (
    (data.qualified / (data.qualified + data.lost)) *
    100
  ).toFixed(1);

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 p-6">
      {/* Metric Cards */}
      <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
        <p className="text-xs font-bold text-gray-400 uppercase">
          Conversion Rate
        </p>
        <h2 className="text-3xl font-black text-indigo-600">
          {conversionRate}%
        </h2>
      </div>
      <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
        <p className="text-xs font-bold text-gray-400 uppercase">Lost Rate</p>
        <h2 className="text-3xl font-black text-red-600">{lostRate}%</h2>
      </div>
      <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
        <p className="text-xs font-bold text-gray-400 uppercase">
          Qualified Rate
        </p>
        <h2 className="text-3xl font-black text-green-600">{qualifiedRate}%</h2>
      </div>
      <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
        <p className="text-xs font-bold text-gray-400 uppercase">
          Qualified vs Lost
        </p>
        <h2 className="text-3xl font-black text-purple-600">
          {qualifiedVsLostRate}%
        </h2>
      </div>

      {/* Funnel Visualization */}
      <div className="md:col-span-4 bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
        <h3 className="font-bold mb-4">Monthly Pipeline Flow</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={[
                { name: "Captured", value: data.total },
                { name: "Qualified", value: data.qualified },
                { name: "Lost", value: data.lost },
              ]}
            >
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#6366f1" radius={[10, 10, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
