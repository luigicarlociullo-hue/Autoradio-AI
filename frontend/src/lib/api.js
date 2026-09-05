import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

export const endpoints = {
  station: () => api.get("/station").then(r => r.data),
  toggle: () => api.post("/station/toggle").then(r => r.data),
  djs: () => api.get("/djs").then(r => r.data),
  createDj: (data) => api.post("/djs", data).then(r => r.data),
  deleteDj: (id) => api.delete(`/djs/${id}`).then(r => r.data),
  segments: () => api.get("/segments").then(r => r.data),
  generateSegment: (params) => api.post("/segments/generate", null, { params, timeout: params?.hd ? 180000 : 30000 }).then(r => r.data),
  renderHD: (id) => api.post(`/segments/${id}/render_hd`, null, { timeout: 180000 }).then(r => r.data),
  clearSegments: () => api.delete("/segments").then(r => r.data),
  tracks: () => api.get("/tracks").then(r => r.data),
  generateTrack: (hint) => api.post("/tracks/generate", null, { params: hint ? { hint } : {} }).then(r => r.data),
  submitQuestion: (data) => api.post("/questions", data).then(r => r.data),
  questions: (onlyPending = false) => api.get("/questions", { params: { only_pending: onlyPending } }).then(r => r.data),
  analytics: () => api.get("/analytics").then(r => r.data),
  session: (session_id) => api.post("/auth/session", { session_id }).then(r => r.data),
  me: () => api.get("/auth/me").then(r => r.data),
  logout: () => api.post("/auth/logout").then(r => r.data),
  audioUrl: (path) => `${API}${path.startsWith("/api") ? path.slice(4) : path}`,
  getJingleRandom: () => api.get("/jingles/random", { timeout: 8000 }).then(r => r.data).catch(() => ({ jingle: null })),
  getStationMode: () => api.get("/station/mode", { timeout: 5000 }).then(r => r.data).catch(() => null),
  setStationMode: (mode, stop_after_current = false) => api.post("/station/mode", null, { params: { mode, stop_after_current } }).then(r => r.data),
  ads: () => api.get("/ads").then(r => r.data),
  adRevenue: () => api.get("/ads/revenue").then(r => r.data),
  adPlays: (id) => api.get(`/ads/${id}/plays`).then(r => r.data),
  telegramStatus: () => api.get("/telegram/status").then(r => r.data),
  // ---- Community "A.I. Vs Umani" ----
  communitySubmit: (formData) => api.post("/community/submit", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 120000,
  }).then(r => r.data),
  communityList: () => api.get("/admin/community").then(r => r.data),
  communityToggle: (id) => api.patch(`/admin/community/${id}/toggle`).then(r => r.data),
  communityDelete: (id) => api.delete(`/admin/community/${id}`).then(r => r.data),
  communityConfigGet: () => api.get("/admin/community/config").then(r => r.data),
  communityConfigSet: (payload) => api.patch("/admin/community/config", payload).then(r => r.data),
  communityUploadJingle: (role, formData) => api.post(
    `/admin/community/config/jingle_${role}`, formData,
    { headers: { "Content-Type": "multipart/form-data" }, timeout: 60000 }
  ).then(r => r.data),
  // ---- Regia Audio ----
  mixGet: () => api.get("/station/mix").then(r => r.data),
  mixSet: (payload) => api.patch("/admin/mix", payload).then(r => r.data),
  bedsList: () => api.get("/admin/beds").then(r => r.data),
  bedUpload: (formData) => api.post("/admin/beds/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" }, timeout: 60000,
  }).then(r => r.data),
  bedActivate: (id) => api.patch(`/admin/beds/${id}/activate`).then(r => r.data),
  bedDeactivate: () => api.patch("/admin/beds/deactivate").then(r => r.data),
  bedDelete: (id) => api.delete(`/admin/beds/${id}`).then(r => r.data),
  ttsProviderGet: () => api.get("/admin/tts/provider").then(r => r.data),
  ttsProviderSet: (provider) => api.patch("/admin/tts/provider", { provider }).then(r => r.data),
  dailyTrack: () => api.get("/tracks/daily").then(r => r.data),
  questionsRecent: (limit = 20) => api.get(`/questions/recent?limit=${limit}`).then(r => r.data),
  // ----- Partner / Main Sponsor -----
  partnersActive: () => api.get("/partners/active").then(r => r.data),
  partnersList: () => api.get("/admin/partners").then(r => r.data),
  partnerCreate: (payload) => api.post("/admin/partners", payload).then(r => r.data),
  partnerUpdate: (id, payload) => api.patch(`/admin/partners/${id}`, payload).then(r => r.data),
  partnerDelete: (id) => api.delete(`/admin/partners/${id}`).then(r => r.data),
  // ----- Club Night + Regia -----
  djPatch: (id, payload) => api.patch(`/djs/${id}`, payload).then(r => r.data),
  trackDelete: (id) => api.delete(`/admin/tracks/${id}`).then(r => r.data),
  trackRestore: (id) => api.post(`/admin/tracks/${id}/restore`).then(r => r.data),
  trackPurge: (id) => api.delete(`/admin/tracks/${id}/purge`).then(r => r.data),
  trackSetGenre: (id, genre) => api.patch(`/admin/tracks/${id}/genre`, { genre }).then(r => r.data),
  trackSetBpm: (id, bpm, source = "client") => api.patch(`/admin/tracks/${id}/bpm`, { bpm, source }).then(r => r.data),
  trashList: () => api.get("/admin/tracks/trash").then(r => r.data),
  trashAutoClean: (days = 30) => api.post("/admin/trash/auto-clean", { days }).then(r => r.data),
  communityWall: () => api.get("/community/wall").then(r => r.data),
  communityTrackPlay: (id) => api.post(`/community/tracks/${id}/play`).then(r => r.data),
  trackNightJingle: (id, isNight) => api.patch(`/tracks/${id}/night-jingle`, { is_night_jingle: !!isNight }).then(r => r.data),
  trackDaypart: (id, day, night) => api.patch(`/admin/tracks/${id}/daypart`, { day: !!day, night: !!night }).then(r => r.data),
  chatAvatar: (payload) => api.post("/chat/avatar", payload).then(r => r.data),
  externalStreamGet: () => api.get("/admin/external-stream").then(r => r.data),
  externalStreamSet: (url) => api.patch("/admin/external-stream", { url: url || "" }).then(r => r.data),
  dualBrainGenerate: (subject) => api.post("/admin/dual-brain/generate", { subject }).then(r => r.data),
  dualBrainInject: (payload) => api.post("/admin/dual-brain/inject", payload).then(r => r.data),
  communityNight: (id, isNight) => api.patch(`/admin/community/${id}/night`, { is_night: !!isNight }).then(r => r.data),
  killSwitch: (enabled, stopAfterCurrent = false) => api.post("/admin/automation/kill-switch", { enabled: !!enabled, stop_after_current: !!stopAfterCurrent }).then(r => r.data),
};
