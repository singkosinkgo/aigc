import { Cloud, Copy, Eye, EyeOff, ImageIcon, Plus, Save, ScrollText, Trash2, Video, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { copyModelConfig, createModelConfig, deleteModelConfig, getErrorMessage, getModelConfigSecret, getModelConfigs, updateModelConfig } from '../lib/api';
import type { ModelConfig, ModelConfigType } from '../types';

const sections: Array<{ type: ModelConfigType; title: string; hint: string }> = [
  { type: 'video', title: '视频模型', hint: '配置用于生成视频的模型，仅启用一个模型' },
  { type: 'image', title: '图片模型', hint: '配置用于生成图片的模型，仅启用一个模型' },
  { type: 'script', title: '剧本模型', hint: '配置用于生成剧本的模型，仅启用一个模型' },
  { type: 'storage', title: '我的云空间', hint: '配置用于存储图片等资源的云空间（图床）' },
];

const emptyForm = {
  name: '',
  type: 'script' as ModelConfigType,
  endpoint: '',
  api_key: '',
  method: 'POST',
  headers_json: '{}',
  params_json: '{}',
  portrait_url: '',
  result_path: '',
  task_id_path: '',
  task_query_endpoint: '',
  enabled: true,
};

const modelGridClass = 'grid grid-cols-[40px_180px_minmax(230px,1fr)_210px_minmax(220px,.85fr)_minmax(280px,1.15fr)_100px_110px]';
const storageGridClass = 'grid grid-cols-[40px_240px_minmax(360px,1fr)_260px_110px_110px]';

export default function ModelsPage() {
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [paramsModal, setParamsModal] = useState<ModelConfig | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Record<number, string>>({});
  const [error, setError] = useState('');

  const grouped = useMemo(() => {
    return sections.reduce<Record<ModelConfigType, ModelConfig[]>>((acc, section) => {
      acc[section.type] = configs.filter((config) => config.type === section.type);
      return acc;
    }, { script: [], image: [], video: [], storage: [] });
  }, [configs]);

  const reload = async () => setConfigs(await getModelConfigs());

  useEffect(() => {
    void reload();
  }, []);

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setError('');
  };

  const startAdd = (type: ModelConfigType) => {
    setEditingId(null);
    setForm({ ...emptyForm, type });
    setError('');
    setModalOpen(true);
  };

  const startEdit = (config: ModelConfig) => {
    setEditingId(config.id);
    setForm({
      name: config.name,
      type: config.type,
      endpoint: config.endpoint,
      api_key: '',
      method: config.method,
      headers_json: JSON.stringify(config.headers_json || {}, null, 2),
      params_json: JSON.stringify(config.params_json || {}, null, 2),
      portrait_url: config.portrait_url || '',
      result_path: config.result_path || '',
      task_id_path: config.task_id_path || '',
      task_query_endpoint: config.task_query_endpoint || '',
      enabled: config.enabled,
    });
    setError('');
    setModalOpen(true);
  };

  const save = async () => {
    setError('');
    try {
      const payload = {
        ...form,
        api_key: form.api_key || undefined,
        headers_json: JSON.parse(form.headers_json || '{}'),
        params_json: JSON.parse(form.params_json || '{}'),
      };
      if (editingId) await updateModelConfig(editingId, payload);
      else await createModelConfig(payload);
      closeModal();
      await reload();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const getSectionIcon = (type: ModelConfigType) => {
    if (type === 'video') return <Video size={18} />;
    if (type === 'image') return <ImageIcon size={18} />;
    if (type === 'script') return <ScrollText size={18} />;
    return <Cloud size={18} />;
  };

  const getAddLabel = (type: ModelConfigType) => {
    if (type === 'script') return '剧本模型';
    if (type === 'image') return '图片模型';
    if (type === 'video') return '视频模型';
    return '云空间';
  };

  const toggleSecret = async (config: ModelConfig) => {
    if (revealedKeys[config.id]) {
      setRevealedKeys(({ [config.id]: _hidden, ...rest }) => rest);
      return;
    }
    setError('');
    try {
      const result = await getModelConfigSecret(config.id);
      setRevealedKeys((items) => ({ ...items, [config.id]: result.api_key || '' }));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const copyConfig = async (id: number) => {
    setError('');
    try {
      await copyModelConfig(id);
      await reload();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const SecretCell = ({ config }: { config: ModelConfig }) => {
    const revealed = Object.prototype.hasOwnProperty.call(revealedKeys, config.id);
    const value = revealed ? revealedKeys[config.id] || '-' : config.api_key_masked || '-';
    return (
      <div className="flex min-w-0 items-center gap-2 pr-5 text-ink/60">
        <span className="min-w-0 truncate">{value}</span>
        <button onClick={() => void toggleSecret(config)} className="shrink-0 text-ink/50 transition hover:text-primary" title={revealed ? '隐藏 API Key' : '查看 API Key'}>
          {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    );
  };

  const ActionCell = ({ config }: { config: ModelConfig }) => (
    <div className="flex items-center gap-3 text-ink/50">
      <button onClick={() => startEdit(config)} className="transition hover:text-primary">编辑</button>
      <button onClick={() => void copyConfig(config.id)} className="transition hover:text-primary" title="复制">
        <Copy size={16} />
      </button>
      <button onClick={() => void deleteModelConfig(config.id).then(reload)} className="transition hover:text-red-500" title="删除">
        <Trash2 size={16} />
      </button>
    </div>
  );

  return (
    <div className="space-y-5">
      {sections.map((section) => (
        <section key={section.type} className="glass-panel rounded-[8px] p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-[7px] bg-gradient-to-br from-[#EEF6FF] to-[#F4F0FF] text-primary">
                {getSectionIcon(section.type)}
              </span>
              <h2 className="text-xl font-black text-ink">{section.title}</h2>
              <span className="text-sm font-semibold text-ink/50">{section.hint}</span>
            </div>
            <button onClick={() => startAdd(section.type)} className="flex items-center gap-2 rounded-[8px] border border-primary px-4 py-2 text-sm font-black text-primary">
              <Plus size={16} /> {getAddLabel(section.type)}
            </button>
          </div>
          <div className="overflow-hidden rounded-[8px] border border-blue-50">
            {section.type === 'storage' ? (
              <div className={`${storageGridClass} bg-blue-50/70 px-4 py-3 text-xs font-black text-ink/60`}>
                <div />
                <div>云空间名称</div>
                <div>地址</div>
                <div>API Key</div>
                <div>状态</div>
                <div>操作</div>
              </div>
            ) : (
              <div className={`${modelGridClass} bg-blue-50/70 px-4 py-3 text-xs font-black text-ink/60`}>
                <div />
                <div>模型名称</div>
                <div>调用地址</div>
                <div>APIKey</div>
                <div>人像</div>
                <div>参数格式</div>
                <div>状态</div>
                <div>操作</div>
              </div>
            )}
            {grouped[section.type].length === 0 ? (
              <div className="px-4 py-8 text-center text-sm font-semibold text-ink/50">暂无{section.type === 'storage' ? '云空间' : '模型'}配置，请点击右上角添加。</div>
            ) : null}
            {grouped[section.type].map((config) =>
              section.type === 'storage' ? (
                <div key={config.id} className={`${storageGridClass} items-center border-t border-blue-50 px-4 py-4 text-sm font-semibold text-ink`}>
                  <input type="radio" checked={config.enabled} onChange={() => void updateModelConfig(config.id, { enabled: true }).then(reload)} className="h-4 w-4 accent-primary" />
                  <div className="min-w-0 truncate font-black">{config.name}</div>
                  <div className="min-w-0 truncate pr-5 text-ink/70">{config.endpoint}</div>
                  <SecretCell config={config} />
                  <div className={config.enabled ? 'text-emerald-600' : 'text-ink/40'}>{config.enabled ? '已启用' : '未启用'}</div>
                  <ActionCell config={config} />
                </div>
              ) : (
                <div key={config.id} className={`${modelGridClass} items-center border-t border-blue-50 px-4 py-4 text-sm font-semibold text-ink`}>
                  <input type="radio" checked={config.enabled} onChange={() => void updateModelConfig(config.id, { enabled: true }).then(reload)} className="h-4 w-4 accent-primary" />
                  <div className="min-w-0 truncate font-black">{config.name}</div>
                  <div className="min-w-0 truncate pr-5 text-ink/70">{config.endpoint}</div>
                  <SecretCell config={config} />
                  <div className="min-w-0 truncate pr-5 text-ink/60">{config.type === 'video' && config.portrait_url ? config.portrait_url : '无'}</div>
                  <button onClick={() => setParamsModal(config)} className="max-h-20 min-w-0 overflow-hidden rounded-[6px] bg-blue-50/60 p-2 text-left text-[11px] text-ink/70 transition hover:bg-blue-100">
                    <pre>{JSON.stringify(config.params_json || {}, null, 2)}</pre>
                  </button>
                  <div className={config.enabled ? 'text-emerald-600' : 'text-ink/40'}>{config.enabled ? '已启用' : '未启用'}</div>
                  <ActionCell config={config} />
                </div>
              )
            )}
          </div>
        </section>
      ))}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-8">
          <div className="max-h-[90vh] w-[860px] overflow-y-auto rounded-[8px] bg-white p-6 shadow-panel">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-2xl font-black text-black">{editingId ? '编辑模型' : '添加模型'}</h2>
              <button onClick={closeModal} className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-blue-50 text-ink/60">
                <X size={20} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <input className="rounded-[8px] border border-blue-100 px-4 py-3 outline-none focus:border-primary" placeholder="模型名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <select className="rounded-[8px] border border-blue-100 px-4 py-3 outline-none focus:border-primary" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as ModelConfigType })}>
                <option value="script">剧本</option>
                <option value="image">图片</option>
                <option value="video">视频</option>
                <option value="storage">云空间</option>
              </select>
              <input className="col-span-2 rounded-[8px] border border-blue-100 px-4 py-3 outline-none focus:border-primary" placeholder="调用地址 endpoint" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} />
              <input className="rounded-[8px] border border-blue-100 px-4 py-3 outline-none focus:border-primary" placeholder={editingId ? '不填则保留原 API Key' : 'API Key'} value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
              <select className="rounded-[8px] border border-blue-100 px-4 py-3 outline-none focus:border-primary" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                <option>POST</option>
                <option>GET</option>
                <option>PUT</option>
              </select>
              <input className="rounded-[8px] border border-blue-100 px-4 py-3 outline-none focus:border-primary" placeholder="result_path，如 data.url" value={form.result_path} onChange={(e) => setForm({ ...form, result_path: e.target.value })} />
              <input className="rounded-[8px] border border-blue-100 px-4 py-3 outline-none focus:border-primary" placeholder="task_id_path" value={form.task_id_path} onChange={(e) => setForm({ ...form, task_id_path: e.target.value })} />
              <input className="col-span-2 rounded-[8px] border border-blue-100 px-4 py-3 outline-none focus:border-primary" placeholder="task_query_endpoint" value={form.task_query_endpoint} onChange={(e) => setForm({ ...form, task_query_endpoint: e.target.value })} />
              {form.type === 'video' ? (
                <input className="col-span-2 rounded-[8px] border border-blue-100 px-4 py-3 outline-none focus:border-primary" placeholder="人像链接，默认无" value={form.portrait_url} onChange={(e) => setForm({ ...form, portrait_url: e.target.value })} />
              ) : null}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <label className="space-y-2 text-sm font-black text-ink">
                <span>headers_json</span>
                <textarea className="h-32 w-full rounded-[8px] border border-blue-100 p-4 font-mono text-xs outline-none focus:border-primary" value={form.headers_json} onChange={(e) => setForm({ ...form, headers_json: e.target.value })} />
              </label>
              <label className="space-y-2 text-sm font-black text-ink">
                <span>params_json</span>
                <textarea className="h-32 w-full rounded-[8px] border border-blue-100 p-4 font-mono text-xs outline-none focus:border-primary" value={form.params_json} onChange={(e) => setForm({ ...form, params_json: e.target.value })} />
              </label>
            </div>
            <div className="mt-5 flex items-center justify-between">
              <label className="flex items-center gap-3 text-sm font-black text-ink">
                <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="h-5 w-5 accent-primary" />
                启用该模型
              </label>
              <button onClick={save} className="gradient-button flex items-center gap-2 rounded-[8px] px-8 py-3 font-black text-white">
                <Save size={18} /> 保存
              </button>
            </div>
            {error ? <div className="mt-3 rounded-[8px] bg-red-50 p-3 text-sm font-semibold text-red-600">{error}</div> : null}
          </div>
        </div>
      ) : null}

      {paramsModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-8">
          <div className="flex max-h-[86vh] w-[760px] flex-col rounded-[8px] bg-white p-6 shadow-panel">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-black text-black">参数格式</h2>
                <div className="mt-1 text-sm font-semibold text-ink/50">{paramsModal.name}</div>
              </div>
              <button onClick={() => setParamsModal(null)} className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-blue-50 text-ink/60">
                <X size={20} />
              </button>
            </div>
            <pre className="max-h-[65vh] overflow-auto rounded-[8px] bg-blue-50/70 p-5 text-xs leading-6 text-ink">
              {JSON.stringify(paramsModal.params_json || {}, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
