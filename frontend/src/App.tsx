import React, { useState, useEffect } from 'react';
import {
  Sparkles, User, Clock, ArrowRight, MessageSquare, Send,
  Image as ImageIcon, BarChart3, TrendingUp, Bot, Activity,
  Database, Link as LinkIcon, CheckCircle2, AlertCircle,
  RefreshCw, Loader2
} from 'lucide-react';
import {
  BarChart, Bar, Cell, ResponsiveContainer, Tooltip,
  XAxis, YAxis, CartesianGrid, AreaChart, Area
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────
interface DashboardStats {
  aiAnswered: number;
  humanPending: number;
  avgLatency: string;
  volumeData: { day: string; queries: number }[];
  latencyData: { time: string; latency: number }[];
}

interface Conversation {
  id: string;
  hyperlink: string | null;
  input: string;
  output: string;
  status: 'answered' | 'human_needed';
  platform: string;
  created_at: string;
  latency_ms: number;
}

// ─── App Root ─────────────────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const tabs = [
    { id: 'Dashboard', label: 'Dashboard', disabled: false },
    { id: 'Automation', label: 'Automation', disabled: false },
    { id: 'Tips', label: 'Tips', disabled: true },
  ];

  return (
    <div className="min-h-screen bg-[#FCFDFD] text-[#2A2A2A] font-sans relative overflow-hidden selection:bg-[#D4AF37]/20 selection:text-[#967520]">
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-[#EADDCD]/30 blur-[120px] pointer-events-none" />
      <div className="absolute top-[40%] right-[-10%] w-[40%] h-[50%] rounded-full bg-[#D4AF37]/5 blur-[100px] pointer-events-none" />

      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-2xl border-b border-[#EADDCD]/60">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="relative flex items-center justify-center w-12 h-12 rounded-full border border-[#D4AF37]/30 bg-gradient-to-br from-white to-[#FDFBF7] shadow-[0_4px_20px_rgba(212,175,55,0.15)]">
              <Sparkles className="text-[#CFA052] w-5 h-5" strokeWidth={1.5} />
            </div>
            <div className="flex flex-col">
              <h1 className="text-2xl font-serif text-[#1A1A1A] tracking-wide">Dhera Singh</h1>
              <span className="text-[0.65rem] uppercase tracking-[0.3em] text-[#CFA052] font-semibold mt-0.5">Jewellers</span>
            </div>
          </div>

          <nav className="flex items-center bg-[#F8F7F5] p-1.5 rounded-full border border-[#EADDCD]/60 shadow-inner">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => !tab.disabled && setActiveTab(tab.id)}
                disabled={tab.disabled}
                title={tab.disabled ? 'Coming in V2' : undefined}
                className={`relative px-8 py-2.5 text-xs uppercase tracking-[0.15em] transition-all duration-500 rounded-full ${
                  activeTab === tab.id
                    ? 'text-white font-medium bg-[#2A2A2A] shadow-[0_4px_15px_rgba(0,0,0,0.1)]'
                    : tab.disabled
                    ? 'text-[#C0C0C0] cursor-not-allowed opacity-50'
                    : 'text-[#8A8A8A] hover:text-[#2A2A2A] hover:bg-white/50'
                }`}
              >
                {tab.label}
                {tab.disabled && (
                  <span className="ml-1 text-[7px] align-super tracking-wider opacity-70">SOON</span>
                )}
              </button>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-3 px-5 py-2 rounded-full border border-[#D4AF37]/30 bg-white shadow-sm">
            <div className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#CFA052] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#CFA052]" />
            </div>
            <span className="text-xs uppercase tracking-[0.15em] text-[#8A8A8A] font-medium">Agent Active</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12 pb-24 relative z-10">
        {activeTab === 'Dashboard' && <DashboardTab />}
        {activeTab === 'Automation' && <AutomationTab />}
        {activeTab === 'Tips' && <TipsTab />}
      </main>
    </div>
  );
}

// ─── Dashboard Tab ────────────────────────────────────────────
function DashboardTab() {
  const [stats, setStats] = useState<DashboardStats>({
    aiAnswered: 0, humanPending: 0, avgLatency: '—',
    volumeData: [], latencyData: []
  });
  const [activity, setActivity] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [sRes, aRes] = await Promise.all([
        fetch('/api/dashboard/stats'),
        fetch('/api/dashboard/activity')
      ]);
      setStats(await sRes.json());
      setActivity(await aRes.json());
    } catch (e) { console.error('Dashboard fetch error:', e); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 30000);
    return () => clearInterval(iv);
  }, []);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-white p-3 border border-[#EADDCD] shadow-[0_4px_20px_rgba(0,0,0,0.08)] rounded-xl">
        <p className="text-[10px] text-[#8A8A8A] uppercase tracking-wider font-semibold mb-1">{label}</p>
        <p className="text-sm text-[#CFA052] font-bold">
          {payload[0].value} {payload[0].dataKey === 'latency' ? 'sec' : 'queries'}
        </p>
      </div>
    );
  };

  return (
    <div className="space-y-12">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard
          title="AI Answered Questions"
          value={loading ? '…' : stats.aiAnswered.toLocaleString()}
          icon={<Bot size={22} className="text-[#CFA052]" strokeWidth={1.5} />}
        />
        <StatCard
          title="Pending Human Interactions"
          value={loading ? '…' : String(stats.humanPending).padStart(2, '0')}
          icon={<User size={22} className="text-[#D9534F]" strokeWidth={1.5} />}
          alert={stats.humanPending > 0}
        />
        <StatCard
          title="Average Answering Time"
          value={loading ? '…' : stats.avgLatency}
          icon={<Clock size={22} className="text-[#CFA052]" strokeWidth={1.5} />}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        <div className="lg:col-span-2 bg-gradient-to-b from-white to-[#FDFBF7] rounded-3xl p-8 border border-[#EADDCD]/60 shadow-sm flex flex-col">
          <h3 className="text-sm uppercase tracking-[0.2em] text-[#8A8A8A] font-medium flex items-center gap-3 mb-2">
            <BarChart3 size={16} className="text-[#CFA052]" /> Query Volume
          </h3>
          <div className="h-64 mt-6 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.volumeData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F0EBE1" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8A8A8A' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8A8A8A' }} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#F8F7F5' }} />
                <Bar dataKey="queries" radius={[4, 4, 0, 0]} maxBarSize={40}>
                  {stats.volumeData.map((_, i) => (
                    <Cell key={i} fill={i === 5 ? '#D4AF37' : '#EADDCD'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-3 bg-gradient-to-b from-white to-[#FDFBF7] rounded-3xl p-8 border border-[#EADDCD]/60 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm uppercase tracking-[0.2em] text-[#8A8A8A] font-medium flex items-center gap-3">
              <Activity size={16} className="text-[#CFA052]" /> Response Latency
            </h3>
            <span className="text-[10px] uppercase tracking-widest text-[#2A2A2A] border border-[#EADDCD] bg-white px-4 py-1.5 rounded-full font-medium shadow-sm">Real-time</span>
          </div>
          <div className="h-64 mt-6 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.latencyData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorLatency" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#CFA052" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#CFA052" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F0EBE1" />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8A8A8A' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8A8A8A' }} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="latency" stroke="#CFA052" strokeWidth={3}
                  fillOpacity={1} fill="url(#colorLatency)"
                  activeDot={{ r: 6, fill: '#CFA052', stroke: '#fff', strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Activity Feed */}
      <div className="bg-white rounded-3xl border border-[#EADDCD]/60 shadow-[0_15px_50px_rgba(0,0,0,0.02)] p-8 md:p-12 relative overflow-hidden">
        <div className="absolute -right-10 -top-10 text-[150px] font-serif text-[#F8F7F5] font-bold pointer-events-none select-none">Log</div>
        <h3 className="text-2xl font-serif text-[#1A1A1A] flex items-center gap-4 mb-12 relative z-10">
          <span className="w-10 h-[1px] bg-[#CFA052]" />
          Live Activity Feed
        </h3>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-[#CFA052]">
            <Loader2 size={28} className="animate-spin" />
          </div>
        ) : activity.length === 0 ? (
          <p className="text-[#8A8A8A] text-center py-20 font-light">No conversations yet. Activity will appear here when customers interact.</p>
        ) : (
          <div className="pl-6 md:pl-10 border-l-2 border-[#EADDCD]/50 space-y-14 relative z-10">
            {activity.map((log) => {
              const timeAgo = getTimeAgo(log.created_at);
              const latencySec = log.latency_ms ? `${(log.latency_ms / 1000).toFixed(1)}s` : '—';
              const isAnswered = log.status === 'answered';
              return (
                <div key={log.id} className="relative">
                  <div className="absolute -left-[31px] md:-left-[47px] top-1 w-4 h-4 rounded-full bg-white border-[3px] border-[#CFA052] shadow-[0_0_12px_rgba(212,175,55,0.3)]" />
                  <div className="flex flex-col gap-5">

                    {/* Customer Query */}
                    <div className="bg-[#FBFBFA] border border-[#EADDCD] p-6 md:p-7 rounded-2xl rounded-tl-none shadow-sm hover:border-[#CFA052]/40 transition-colors">
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-[#2A2A2A] flex items-center justify-center shadow-md">
                            <User size={18} className="text-white" />
                          </div>
                          <div>
                            <span className="block text-xs font-bold text-[#2A2A2A] uppercase tracking-wider">Customer</span>
                            <span className="block text-[11px] text-[#8A8A8A] mt-0.5">
                              {timeAgo} · <span className="capitalize">{(log.platform || '').replace('_', ' ')}</span>
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] uppercase tracking-widest text-[#8A8A8A] bg-white border border-[#EADDCD] px-3 py-1.5 rounded-full font-semibold shadow-sm">Query</span>
                      </div>
                      {/* Hyperlinked query text */}
                      {log.hyperlink ? (
                        <a href={log.hyperlink} target="_blank" rel="noreferrer"
                          className="text-[#1A1A1A] font-serif text-lg md:text-xl leading-relaxed hover:text-[#CFA052] transition-colors underline underline-offset-4 decoration-[#EADDCD]">
                          "{log.input}"
                        </a>
                      ) : (
                        <p className="text-[#1A1A1A] font-serif text-lg md:text-xl leading-relaxed">"{log.input}"</p>
                      )}
                    </div>

                    {/* AI Response — Answered */}
                    {isAnswered ? (
                      <div className="bg-gradient-to-br from-white to-[#FDFBF7] border border-[#CFA052]/30 p-6 md:p-7 rounded-2xl rounded-bl-none shadow-[0_8px_30px_rgba(212,175,55,0.06)] ml-4 md:ml-12 hover:border-[#CFA052]/60 transition-colors">
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#CFA052] flex items-center justify-center shadow-md">
                              <Bot size={18} className="text-white" />
                            </div>
                            <div>
                              <span className="block text-xs font-bold text-[#CFA052] uppercase tracking-wider">AI Agent</span>
                              <span className="block text-[11px] text-[#8A8A8A] mt-0.5">{timeAgo} · <span className="text-[#CFA052] font-medium">{latencySec}</span></span>
                            </div>
                          </div>
                          <span className="text-[10px] uppercase tracking-widest text-[#10B981] bg-[#10B981]/10 border border-[#10B981]/20 px-3 py-1.5 rounded-full font-bold flex items-center gap-1.5">
                            <CheckCircle2 size={12} strokeWidth={2.5} /> Answered
                          </span>
                        </div>
                        <p className="text-[#4A4A4A] font-light text-base md:text-lg leading-relaxed">{log.output}</p>
                      </div>
                    ) : (
                      /* Human Intervention Needed */
                      <div className="bg-gradient-to-br from-white to-red-50/40 border border-red-200 p-6 md:p-7 rounded-2xl rounded-bl-none shadow-[0_8px_30px_rgba(217,83,79,0.06)] ml-4 md:ml-12 transition-colors">
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center border border-red-200 shadow-sm">
                              <AlertCircle size={18} className="text-[#D9534F]" />
                            </div>
                            <div>
                              <span className="block text-xs font-bold text-[#D9534F] uppercase tracking-wider">Requires Human Review</span>
                              <span className="block text-[11px] text-[#8A8A8A] mt-0.5">{timeAgo} · Escalated</span>
                            </div>
                          </div>
                          <span className="text-[10px] uppercase tracking-widest text-[#D9534F] bg-red-50 border border-red-200 px-3 py-1.5 rounded-full font-bold flex items-center gap-1.5 animate-pulse">
                            <AlertCircle size={12} strokeWidth={2.5} /> Pending
                          </span>
                        </div>
                        <p className="text-[#8A8A8A] font-light text-sm italic border-l-2 border-red-200 pl-4">
                          This query was beyond the AI's context. A customer reply was sent and the conversation has been flagged for your personal attention, Ji.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Automation Tab ───────────────────────────────────────────
function AutomationTab() {
  const [keyword, setKeyword] = useState('');
  const [explanation, setExplanation] = useState('');
  const [instagramLink, setInstagramLink] = useState('');
  const [productId, setProductId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setMessage(null);
    try {
      const ops: Promise<Response>[] = [];

      if (keyword.trim() || explanation.trim()) {
        ops.push(fetch('/api/automation/context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword, explanation })
        }));
      }

      if (instagramLink.trim() && productId.trim()) {
        ops.push(fetch('/api/automation/product', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instagramLink, productId })
        }));
      }

      if (!ops.length) {
        setMessage({ type: 'error', text: 'Please fill at least one set of fields.' });
        return;
      }

      await Promise.all(ops);
      setMessage({ type: 'success', text: 'Knowledge base updated successfully, Ji! ✨' });
      setKeyword(''); setExplanation(''); setInstagramLink(''); setProductId('');
    } catch {
      setMessage({ type: 'error', text: 'Something went wrong. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto py-4">
      <div className="mb-20 text-center relative">
        <div className="inline-flex items-center justify-center gap-3 mb-6">
          <span className="h-[1px] w-12 bg-[#D4AF37]/50" />
          <span className="text-[#CFA052] font-semibold text-xs uppercase tracking-[0.3em]">Knowledge Base</span>
          <span className="h-[1px] w-12 bg-[#D4AF37]/50" />
        </div>
        <h2 className="text-4xl md:text-5xl font-serif text-[#1A1A1A] tracking-wide mb-4">Automated Agent Training</h2>
        <p className="text-[#8A8A8A] font-light text-sm max-w-xl mx-auto leading-relaxed">
          Seamlessly integrate new collections, keywords, and promotional content into your AI concierge's active memory bank.
        </p>
      </div>

      <div className="relative">
        <div className="absolute left-[24px] md:left-1/2 top-0 bottom-0 w-[1px] bg-gradient-to-b from-[#EADDCD] via-[#CFA052] to-transparent md:-translate-x-1/2" />
        <div className="space-y-16">

          {/* Step 01: Keywords */}
          <div className="relative flex flex-col md:flex-row items-center md:justify-between group">
            <div className="hidden md:block md:w-[45%] text-right pr-12 relative">
              <span className="absolute -right-8 top-1/2 -translate-y-1/2 text-[120px] font-serif text-[#F8F7F5] font-bold z-0 pointer-events-none select-none">01</span>
              <h3 className="text-2xl font-serif text-[#1A1A1A] relative z-10 mb-2">Add Context</h3>
              <p className="text-sm text-[#8A8A8A] tracking-wide">Define semantic triggers</p>
            </div>
            <div className="absolute left-0 md:left-1/2 w-12 h-12 rounded-full bg-white border border-[#CFA052] shadow-[0_0_20px_rgba(212,175,55,0.2)] md:-translate-x-1/2 flex items-center justify-center z-10">
              <Database className="text-[#CFA052] w-5 h-5" strokeWidth={1.5} />
            </div>
            <div className="w-full pl-20 md:pl-0 md:w-[45%]">
              <div className="bg-white p-6 rounded-2xl border border-[#EADDCD] shadow-[0_10px_40px_rgba(0,0,0,0.03)] hover:shadow-[0_10px_40px_rgba(212,175,55,0.08)] transition-all duration-500 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-transparent to-[#CFA052] opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <label className="block text-xs uppercase tracking-[0.2em] text-[#CFA052] mb-3 font-semibold md:hidden">01. Context</label>
                <div className="flex items-center gap-4">
                  <span className="text-[#8A8A8A] font-light italic shrink-0">Keywords:</span>
                  <input type="text" value={keyword} onChange={e => setKeyword(e.target.value)}
                    placeholder="e.g. Polki, Choker, Bridal…"
                    className="w-full bg-transparent border-b border-[#EADDCD] p-2 text-[#2A2A2A] focus:outline-none focus:border-[#CFA052] placeholder:text-[#D1D1D1] font-light transition-colors" />
                  <ArrowRight className="text-[#D1D1D1] group-hover:text-[#CFA052] transition-colors shrink-0" size={20} strokeWidth={1.5} />
                </div>
              </div>
            </div>
          </div>

          {/* Step 02: Explanation */}
          <div className="relative flex flex-col md:flex-row-reverse items-center md:justify-between group">
            <div className="hidden md:block md:w-[45%] text-left pl-12 relative">
              <span className="absolute -left-8 top-1/2 -translate-y-1/2 text-[120px] font-serif text-[#F8F7F5] font-bold z-0 pointer-events-none select-none">02</span>
              <h3 className="text-2xl font-serif text-[#1A1A1A] relative z-10 mb-2">Explain Addition</h3>
              <p className="text-sm text-[#8A8A8A] tracking-wide">Provide AI reasoning</p>
            </div>
            <div className="absolute left-0 md:left-1/2 w-12 h-12 rounded-full bg-white border border-[#CFA052] shadow-[0_0_20px_rgba(212,175,55,0.2)] md:-translate-x-1/2 flex items-center justify-center z-10">
              <MessageSquare className="text-[#CFA052] w-5 h-5" strokeWidth={1.5} />
            </div>
            <div className="w-full pl-20 md:pl-0 md:w-[45%] text-right">
              <div className="bg-white p-6 rounded-2xl border border-[#EADDCD] shadow-[0_10px_40px_rgba(0,0,0,0.03)] hover:shadow-[0_10px_40px_rgba(212,175,55,0.08)] transition-all duration-500 relative overflow-hidden text-left">
                <div className="absolute top-0 right-0 w-1 h-full bg-gradient-to-b from-transparent to-[#CFA052] opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <label className="block text-xs uppercase tracking-[0.2em] text-[#CFA052] mb-3 font-semibold md:hidden">02. Explain Addition</label>
                <div className="relative">
                  <textarea value={explanation} onChange={e => setExplanation(e.target.value)}
                    placeholder="Type your explanation here to train the agent…"
                    rows={3}
                    className="w-full bg-[#FBFBFA] border border-[#EADDCD] rounded-xl p-4 text-[#2A2A2A] focus:outline-none focus:border-[#CFA052] focus:ring-1 focus:ring-[#CFA052] placeholder:text-[#D1D1D1] font-light resize-none transition-all shadow-inner" />
                  <div className="absolute bottom-4 right-4 bg-white rounded-full p-2 shadow-sm border border-[#EADDCD]">
                    <ArrowRight className="text-[#D1D1D1] group-hover:text-[#CFA052] transition-colors" size={16} strokeWidth={2} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Step 03: Product Sync */}
          <div className="relative flex flex-col md:flex-row items-center md:justify-between group">
            <div className="hidden md:block md:w-[45%] text-right pr-12 relative">
              <span className="absolute -right-8 top-1/2 -translate-y-1/2 text-[120px] font-serif text-[#F8F7F5] font-bold z-0 pointer-events-none select-none">03</span>
              <h3 className="text-2xl font-serif text-[#1A1A1A] relative z-10 mb-2">Product Sync</h3>
              <p className="text-sm text-[#8A8A8A] tracking-wide">Link inventory to media</p>
            </div>
            <div className="absolute left-0 md:left-1/2 w-12 h-12 rounded-full bg-[#2A2A2A] border border-[#2A2A2A] shadow-[0_0_20px_rgba(0,0,0,0.2)] md:-translate-x-1/2 flex items-center justify-center z-10">
              <LinkIcon className="text-white w-5 h-5" strokeWidth={1.5} />
            </div>
            <div className="w-full pl-20 md:pl-0 md:w-[45%]">
              <div className="bg-white p-6 rounded-2xl border border-[#EADDCD] shadow-[0_10px_40px_rgba(0,0,0,0.03)] hover:shadow-[0_10px_40px_rgba(212,175,55,0.08)] transition-all duration-500 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-transparent to-[#2A2A2A] opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <label className="block text-xs uppercase tracking-[0.2em] text-[#CFA052] mb-3 font-semibold md:hidden">03. Product / Reel Details</label>
                <div className="flex flex-col gap-5">
                  <div className="flex items-center gap-4">
                    <input type="text" value={instagramLink} onChange={e => setInstagramLink(e.target.value)}
                      placeholder="Instagram Post Link (e.g. https://www.instagram.com/p/…)"
                      className="flex-1 bg-transparent border-b border-[#EADDCD] p-2 text-[#2A2A2A] focus:outline-none focus:border-[#2A2A2A] placeholder:text-[#D1D1D1] font-light transition-colors" />
                    <ArrowRight className="text-[#D1D1D1] group-hover:text-[#2A2A2A] transition-colors shrink-0" size={18} strokeWidth={1.5} />
                  </div>
                  <div className="flex items-center gap-4">
                    <input type="text" value={productId} onChange={e => setProductId(e.target.value)}
                      placeholder="Product ID (e.g. SKU-1049)"
                      className="w-1/2 bg-transparent border-b border-[#EADDCD] p-2 text-[#2A2A2A] focus:outline-none focus:border-[#2A2A2A] placeholder:text-[#D1D1D1] font-light transition-colors" />
                    <ArrowRight className="text-[#D1D1D1] group-hover:text-[#2A2A2A] transition-colors shrink-0" size={18} strokeWidth={1.5} />
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Submit */}
      <div className="mt-20 flex flex-col items-center gap-4">
        {message && (
          <div className={`px-6 py-3 rounded-full text-sm font-medium ${
            message.type === 'success'
              ? 'bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20'
              : 'bg-red-50 text-red-500 border border-red-200'
          }`}>
            {message.text}
          </div>
        )}
        <button onClick={handleSubmit} disabled={submitting}
          className="group relative px-10 py-4 bg-[#2A2A2A] text-white rounded-full overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.15)] hover:shadow-[0_10px_40px_rgba(212,175,55,0.3)] transition-all duration-500 disabled:opacity-60">
          <div className="absolute inset-0 bg-gradient-to-r from-[#CFA052] to-[#D4AF37] opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <span className="relative z-10 flex items-center gap-3 text-sm uppercase tracking-[0.2em] font-medium">
            {submitting
              ? <><Loader2 size={16} className="animate-spin" /> Updating…</>
              : <><Sparkles size={16} /> Update Knowledge Base</>
            }
          </span>
        </button>
      </div>
    </div>
  );
}

// ─── Tips Tab (Coming Soon) ────────────────────────────────────
function TipsTab() {
  return (
    <div className="max-w-5xl mx-auto h-[80vh] flex flex-col items-center justify-center relative z-10">
      <div className="text-center space-y-6">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-[#F8F7F5] border border-[#EADDCD] shadow-inner">
          <Sparkles className="text-[#CFA052] w-8 h-8" strokeWidth={1.5} />
        </div>
        <h2 className="text-4xl font-serif text-[#1A1A1A] tracking-wide">Marketing Concierge</h2>
        <p className="text-[#8A8A8A] font-light text-sm max-w-sm mx-auto leading-relaxed">
          AI-powered caption writing, reel scripting, and hashtag strategy is coming in <span className="text-[#CFA052] font-medium">Version 2</span>.
        </p>
        <div className="inline-flex items-center gap-3 px-6 py-3 rounded-full border border-[#D4AF37]/30 bg-white shadow-sm">
          <span className="text-xs uppercase tracking-[0.3em] text-[#CFA052] font-semibold">Coming Soon</span>
        </div>
      </div>
    </div>
  );
}

// ─── StatCard ─────────────────────────────────────────────────
function StatCard({ title, value, icon, alert = false }: { title: string; value: string | number; icon: React.ReactNode; alert?: boolean }) {
  return (
    <div className={`relative p-6 md:p-8 rounded-3xl border shadow-sm group overflow-hidden transition-all duration-500 hover:-translate-y-1 ${
      alert
        ? 'bg-gradient-to-br from-white to-red-50/40 border-red-100 hover:border-red-200 hover:shadow-[0_10px_30px_rgba(217,83,79,0.1)]'
        : 'bg-gradient-to-br from-white to-[#F8F7F5] border-[#EADDCD]/60 hover:border-[#CFA052]/40 hover:shadow-[0_10px_30px_rgba(212,175,55,0.08)]'
    }`}>
      <div className="flex justify-between items-start mb-8 relative z-10">
        <div className={`p-3 rounded-2xl border shadow-sm ${alert ? 'bg-red-50 border-red-100' : 'bg-white border-[#EADDCD]'}`}>
          {icon}
        </div>
        {alert && (
          <span className="text-[9px] uppercase tracking-widest text-red-600 bg-red-50 border border-red-100 px-3 py-1.5 rounded-full font-bold animate-pulse">
            Attention Needed
          </span>
        )}
      </div>
      <div className="relative z-10">
        <div className="flex items-end gap-3 mb-1">
          <span className="text-4xl md:text-5xl font-serif text-[#1A1A1A]">{value}</span>
        </div>
        <h4 className="text-[#8A8A8A] font-medium text-[10px] md:text-xs uppercase tracking-[0.2em] mt-3">{title}</h4>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────
function getTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}