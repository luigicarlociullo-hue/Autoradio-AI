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
};
