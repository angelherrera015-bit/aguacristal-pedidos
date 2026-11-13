import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,signInWithEmailAndPassword,signOut,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,collection,doc,getDoc,getDocs,setDoc,addDoc,updateDoc,deleteDoc,query,where,onSnapshot,serverTimestamp,arrayUnion,increment} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 1) PEGA AQUÍ LA CONFIGURACIÓN DE TU PROYECTO FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyAOpuw8OQrSrKlzJL16Xb-vt58k4WEYUuU",
  authDomain: "agua-cristal06.firebaseapp.com",
  projectId: "agua-cristal06",
  storageBucket: "agua-cristal06.firebasestorage.app",
  messagingSenderId: "600517753248",
  appId: "1:600517753248:web:f1c444619e5a08f1354cc5"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app), db = getFirestore(app);
const $ = id => document.getElementById(id);
const MARCAS = [["salvavidas","Salvavidas"],["scandia","Scandia"],["carrera","Carrera"],["sinmarca","Sin marca"]];
const PRECIO = {domicilio:10, local:9};
const METAS0 = {1:65,2:55,3:50,4:50,5:50,6:65};
const DIAS = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
const fecha = d => d.toLocaleDateString("sv");
const hoy = () => fecha(new Date());
const lunes = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay()+6)%7)); return fecha(d); };
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

let rol = "operador", tipo = "domicilio", cli = null, cant = {}, metas = {...METAS0}, pedidos = [], escuchando = false;
MARCAS.forEach(([k]) => cant[k] = 0);

/* ---------- Acceso ---------- */
$("btnLogin").onclick = async () => {
  try { await signInWithEmailAndPassword(auth, $("em").value.trim(), $("pw").value); $("err").textContent = ""; }
  catch { $("err").textContent = "Correo o contraseña incorrectos."; }
};
$("btnSalir").onclick = () => signOut(auth);
onAuthStateChanged(auth, async u => {
  $("login").hidden = !!u; $("app").hidden = !u;
  if (!u) return;
  const s = await getDoc(doc(db, "usuarios", u.uid));
  rol = s.exists() ? s.data().rol : "operador";
  document.body.classList.toggle("maestro", rol === "maestro");
  $("quien").textContent = u.email + " · " + rol;
  if (!escuchando) { escuchando = true; iniciar(); }
});

/* ---------- Navegación ---------- */
document.querySelectorAll("nav button").forEach(b => b.onclick = () => {
  document.querySelectorAll("nav button").forEach(x => x.classList.toggle("on", x === b));
  document.querySelectorAll(".tab").forEach(t => t.hidden = t.id !== "t-" + b.dataset.t);
});

/* ---------- Toma de pedido ---------- */
function pintarMarcas() {
  $("marcas").innerHTML = MARCAS.map(([k,n]) =>
    `<div class="marca"><b>${n}</b><div><button data-m="${k}" data-d="-1">−</button><span>${cant[k]}</span><button data-m="${k}" data-d="1">+</button></div></div>`).join("");
  const n = Object.values(cant).reduce((a,b) => a+b, 0);
  $("totTxt").textContent = `${n} garrafón(es) · Q${n * PRECIO[tipo]}`;
}
$("marcas").onclick = e => {
  const b = e.target.closest("button"); if (!b) return;
  cant[b.dataset.m] = Math.max(0, cant[b.dataset.m] + +b.dataset.d); pintarMarcas();
};
function setTipo(t) {
  tipo = t; $("bDom").classList.toggle("on", t === "domicilio"); $("bLoc").classList.toggle("on", t === "local");
  $("datos").hidden = t === "local"; pintarMarcas();
}
$("bDom").onclick = () => setTipo("domicilio"); $("bLoc").onclick = () => setTipo("local");

function mostrarDir() { $("dirNueva").hidden = !($("dirSel").hidden || $("dirSel").value === "nueva"); }
$("dirSel").onchange = mostrarDir;
async function buscar() {
  const t = $("tel").value.replace(/\D/g, ""); if (t.length < 8) return;
  const s = await getDoc(doc(db, "clientes", t)); cli = s.exists() ? s.data() : null;
  const sel = $("dirSel");
  if (cli) {
    $("estado").textContent = "Cliente encontrado";
    $("nombre").value = cli.nombre || ""; $("apellido").value = cli.apellido || ""; $("tel2").value = cli.tel2 || "";
    sel.innerHTML = (cli.direcciones || []).map(d => `<option>${esc(d)}</option>`).join("") + `<option value="nueva">➕ Nueva dirección</option>`;
    sel.hidden = false;
  } else { $("estado").textContent = "Cliente nuevo: completa los datos"; sel.hidden = true; sel.innerHTML = ""; }
  mostrarDir();
}
$("tel").oninput = () => { if ($("tel").value.length === 8) buscar(); else { $("estado").textContent = ""; $("dirSel").hidden = true; cli = null; mostrarDir(); } };

$("btnGuardar").onclick = async () => {
  const n = Object.values(cant).reduce((a,b) => a+b, 0);
  if (!n) return alert("Agrega al menos un garrafón.");
  const p = { tipo, items:{...cant}, cantidad:n, total:n*PRECIO[tipo], entregado:tipo === "local",
    fecha:hoy(), hora:new Date().toLocaleTimeString("es-GT",{hour12:false}), por:auth.currentUser.email, ts:serverTimestamp(),
    tel:"", nombre:"", direccion:"" };
  try {
    if (tipo === "domicilio") {
      const tel = $("tel").value.replace(/\D/g, ""), nom = $("nombre").value.trim(), ape = $("apellido").value.trim();
      const dir = (!$("dirSel").hidden && $("dirSel").value !== "nueva") ? $("dirSel").value : $("dirNueva").value.trim();
      if (tel.length !== 8 || !dir) return alert("Faltan el teléfono (8 dígitos) o la dirección.");
      const c = { direcciones:arrayUnion(dir) };
      if (nom) c.nombre = nom;
      if (ape) c.apellido = ape;
      if ($("tel2").value.trim()) c.tel2 = $("tel2").value.trim();
      await setDoc(doc(db, "clientes", tel), c, {merge:true});
      Object.assign(p, {tel, nombre:(nom + " " + ape).trim(), direccion:dir});
    }
    await addDoc(collection(db, "pedidos"), p);
    await moverStock(n, -1);
    if (tipo === "domicilio") imprimir(p);
    MARCAS.forEach(([k]) => cant[k] = 0);
    ["tel","nombre","apellido","dirNueva","tel2"].forEach(i => $(i).value = "");
    $("dirSel").hidden = true; $("estado").textContent = ""; cli = null; mostrarDir(); pintarMarcas();
  } catch (e) { alert("No se pudo guardar: " + e.message); }
};

function mix(it) { return MARCAS.filter(([k]) => it[k]).map(([k,n]) => `${it[k]} ${n}`).join(", "); }
function imprimir(p) {
  $("ticket").innerHTML = `<h2>AGUA CRISTAL</h2><p>${p.fecha} ${p.hora}</p><hr>
    <p><b>${esc(p.nombre || "Sin nombre")}</b><br>Tel: ${esc(p.tel)}<br>${esc(p.direccion)}</p><hr>
    ${MARCAS.filter(([k]) => p.items[k]).map(([k,n]) => `<p>${p.items[k]} x ${n}</p>`).join("")}
    <hr><p><b>Total: ${p.cantidad} garrafón(es) · Q${p.total}</b></p>`;
  setTimeout(() => window.print(), 200);
}

/* ---------- Ventas y metas ---------- */
function iniciar() {
  $("dia").value = hoy(); $("dia").min = lunes(); $("dia").max = hoy(); $("dia").onchange = pintar;
  $("inputsMeta").innerHTML = [1,2,3,4,5,6].map(d => `<label>${DIAS[d]}<input type="number" min="0" data-d="${d}"></label>`).join("");
  onSnapshot(doc(db, "config", "consumo"), s => { consumo = s.exists() ? s.data() : {}; pintarAdmin(); });
  if (rol === "maestro") iniciarAdmin();
  onSnapshot(doc(db, "config", "metas"), s => { metas = s.exists() ? {...METAS0, ...s.data()} : {...METAS0}; pintar(); });
  onSnapshot(query(collection(db, "pedidos"), where("fecha", ">=", lunes())), s => {
    pedidos = s.docs.map(d => ({id:d.id, ...d.data()})); pintar();
  });
}
function suma(arr) { return arr.reduce((a,p) => a + p.cantidad, 0); }
function pintar() {
  const d = $("dia").value || hoy(), del = pedidos.filter(p => p.fecha === d).sort((a,b) => b.hora.localeCompare(a.hora));
  const loc = del.filter(p => p.tipo === "local"), dom = del.filter(p => p.tipo === "domicilio");
  const q = a => a.reduce((s,p) => s + p.total, 0);
  $("resumen").innerHTML = `<div class="kpi"><div><b>${suma(loc)}</b>Local · Q${q(loc)}</div><div><b>${suma(dom)}</b>Domicilio · Q${q(dom)}</div><div><b>${del.filter(p => p.entregado).length}/${del.length}</b>Entregados</div></div>`;
  $("lista").innerHTML = del.map(p => `<div class="ped ${p.entregado ? "ok" : ""}">
    <input type="checkbox" data-id="${p.id}" ${p.entregado ? "checked" : ""}>
    <div class="info"><b>${p.tipo === "local" ? "🏪 Local" : "🛵 " + esc(p.nombre || "Sin nombre")}</b> · ${p.hora.slice(0,5)}<br>${p.tipo === "domicilio" ? esc(p.direccion) + " · " + esc(p.tel) + "<br>" : ""}${mix(p.items)} · Q${p.total}</div>
    <span class="solo-maestro"><button data-id="${p.id}" class="ed">✏️</button><button data-id="${p.id}" class="del">🗑️</button></span></div>`).join("") || "<p>Sin pedidos este día.</p>";

  const t = new Date(), meta = metas[t.getDay()] || 0, hechos = suma(pedidos.filter(p => p.fecha === hoy()));
  const semMeta = [1,2,3,4,5,6].reduce((s,k) => s + (+metas[k] || 0), 0), semHechos = suma(pedidos);
  const bloque = (tit, h, m, ok, falta) => `<div class="card"><h3>${tit}</h3><div class="barra"><i style="width:${m ? Math.min(100, h/m*100) : 0}%"></i></div>
    <b>${h} de ${m}</b><p>${m === 0 ? "Hoy no hay meta." : h >= m ? ok : `Faltan ${m - h} ${falta}`}</p></div>`;
  $("metaHoy").innerHTML = bloque("Meta de hoy", hechos, meta, "¡Felicidades, cumplieron la meta de hoy!", "garrafones para cumplir la meta de hoy.");
  $("metaSem").innerHTML = bloque("Meta de la semana", semHechos, semMeta, "¡Felicidades, esta semana cumplieron la meta!", "garrafones para cumplir la meta de la semana.");
  document.querySelectorAll("#inputsMeta input").forEach(i => { if (document.activeElement !== i) i.value = metas[i.dataset.d]; });
}
$("lista").onclick = async e => {
  const b = e.target.closest("button"); if (!b) return;
  const ref = doc(db, "pedidos", b.dataset.id);
  if (b.classList.contains("del") && confirm("¿Eliminar este pedido?")) { const p = pedidos.find(x => x.id === b.dataset.id); await deleteDoc(ref); if (p) await moverStock(p.cantidad, 1); }
  if (b.classList.contains("ed")) {
    const p = pedidos.find(x => x.id === b.dataset.id);
    const nombre = prompt("Nombre", p.nombre); if (nombre === null) return;
    const direccion = prompt("Dirección", p.direccion); if (direccion === null) return;
    await updateDoc(ref, {nombre, direccion});
  }
};
$("lista").onchange = async e => {
  if (e.target.type === "checkbox") await updateDoc(doc(db, "pedidos", e.target.dataset.id), {entregado:e.target.checked});
};
$("btnMetas").onclick = async () => {
  const m = {}; document.querySelectorAll("#inputsMeta input").forEach(i => m[i.dataset.d] = +i.value || 0);
  await setDoc(doc(db, "config", "metas"), m); alert("Metas guardadas.");
};
$("btnExcel").onclick = async () => {
  const s = await getDocs(collection(db, "pedidos"));
  const filas = s.docs.map(d => d.data()).sort((a,b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora)).map(p => ({
    Fecha:p.fecha, Hora:p.hora, Tipo:p.tipo, Cliente:p.nombre, Teléfono:p.tel, Dirección:p.direccion,
    Salvavidas:p.items.salvavidas || 0, Scandia:p.items.scandia || 0, Carrera:p.items.carrera || 0, "Sin marca":p.items.sinmarca || 0,
    Garrafones:p.cantidad, "Total Q":p.total, Entregado:p.entregado ? "Sí" : "No", Registró:p.por }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), "Ventas");
  XLSX.writeFile(wb, `ventas-agua-cristal-${hoy()}.xlsx`);
};

/* ---------- Inventario, gastos y resultado (solo administrador) ---------- */
const FIJOS = [["Alquiler",1500],["Agua",1000],["Repartidor",4000],["Operadora",3500],["Luz",200],["Internet",100],["Reserva bono 14 y aguinaldo",933.33]];
const FIJO_MES = FIJOS.reduce((a,[,m]) => a + m, 0), EQUILIBRIO = 51;
let consumo = {}, inv = [], gastos = [], pedMes = [];
const Q = n => "Q" + (+n).toLocaleString("es-GT",{minimumFractionDigits:2,maximumFractionDigits:2});
const mesIni = () => hoy().slice(0,7) + "-01";
async function moverStock(n, signo) {
  for (const [id,c] of Object.entries(consumo)) if (c > 0) try { await updateDoc(doc(db,"inventario",id), {stock:increment(signo*n*c)}); } catch {}
}
function diasLaborados() { const t = new Date(); let n = 0; for (let d = 1; d <= t.getDate(); d++) if (new Date(t.getFullYear(), t.getMonth(), d).getDay()) n++; return n; }
function iniciarAdmin() {
  onSnapshot(collection(db,"inventario"), s => { inv = s.docs.map(d => ({id:d.id, ...d.data()})); pintarAdmin(); });
  onSnapshot(query(collection(db,"gastos"), where("fecha",">=",mesIni())), s => { gastos = s.docs.map(d => ({id:d.id, ...d.data()})); pintarAdmin(); });
  onSnapshot(query(collection(db,"pedidos"), where("fecha",">=",mesIni())), s => { pedMes = s.docs.map(d => d.data()); pintarAdmin(); });
}
function pintarAdmin() {
  if (rol !== "maestro") return;
  const ing = pedMes.reduce((s,p) => s + p.total, 0), gas = gastos.reduce((s,g) => s + g.monto, 0);
  const fij = FIJO_MES * Math.min(diasLaborados(), 26) / 26, gan = ing - gas - fij;
  $("resAdmin").innerHTML = `<div class="card"><h3>Resultado del mes (real)</h3><div class="kpi"><div><b>${Q(ing)}</b>Ingresos</div><div><b>${Q(gas + fij)}</b>Gastos</div><div><b style="color:${gan < 0 ? "#c0392b" : "var(--ok)"}">${Q(gan)}</b>Ganancia</div></div><p>Gastos = compras e imprevistos ${Q(gas)} + fijos prorrateados ${Q(fij)}. Equilibrio diario: ${EQUILIBRIO} garrafones.</p></div>`;
  $("gItem").innerHTML = inv.map(i => `<option value="${i.id}">${esc(i.nombre)}</option>`).join("");
  $("gItem").hidden = $("gCant").hidden = $("gTipo").value !== "compra";
  $("invLista").innerHTML = inv.map(i => `<div class="ped ${i.stock <= i.minimo ? "bajo" : ""}"><div class="info"><b>${esc(i.nombre)}</b>: ${+(+i.stock).toFixed(1)} ${esc(i.unidad || "")}${i.stock <= i.minimo ? " ⚠️ stock bajo" : ""}<br>Consumo por garrafón: ${consumo[i.id] || 0}</div><button data-id="${i.id}" class="aj">✏️</button></div>`).join("") || "<p>Sin insumos. Crea el primero.</p>";
  $("gastosLista").innerHTML = gastos.sort((a,b) => b.fecha.localeCompare(a.fecha)).map(g => `<div class="ped"><div class="info">${g.fecha} · <b>${esc(g.concepto)}</b> · ${Q(g.monto)}</div><button data-id="${g.id}" class="dg">🗑️</button></div>`).join("") || "<p>Sin gastos este mes.</p>";
}
$("gTipo").onchange = pintarAdmin;
$("btnGasto").onclick = async () => {
  const monto = +$("gMonto").value, t = $("gTipo").value, itemId = $("gItem").value, cantidad = +$("gCant").value;
  let concepto = $("gConc").value.trim();
  if (!(monto > 0)) return alert("Escribe el monto.");
  if (t === "compra") { if (!itemId || !(cantidad > 0)) return alert("Elige el insumo y la cantidad."); concepto = concepto || inv.find(i => i.id === itemId).nombre; }
  else if (!concepto) return alert("Escribe el concepto.");
  const g = {fecha:hoy(), tipo:t, concepto, monto, por:auth.currentUser.email, ts:serverTimestamp()};
  if (t === "compra") Object.assign(g, {itemId, cantidad});
  await addDoc(collection(db,"gastos"), g);
  if (t === "compra") await updateDoc(doc(db,"inventario",itemId), {stock:increment(cantidad)});
  ["gCant","gConc","gMonto"].forEach(i => $(i).value = "");
};
$("btnNuevoItem").onclick = async () => {
  const nombre = prompt("Nombre del insumo (ej. Tapones)"); if (!nombre) return;
  const unidad = prompt("Unidad (ej. tapones, lb, bolsa)", "unidades") || "";
  const stock = +prompt("Stock actual", 0) || 0, minimo = +prompt("Avisar cuando quede (stock mínimo)", 0) || 0;
  const c = +prompt("Cuánto se gasta por cada garrafón (0 si no aplica). Ej. tapones: 1", 0) || 0;
  const id = nombre.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
  await setDoc(doc(db,"inventario",id), {nombre, unidad, stock, minimo});
  await setDoc(doc(db,"config","consumo"), {[id]:c}, {merge:true});
};
$("invLista").onclick = async e => {
  const b = e.target.closest(".aj"); if (!b) return; const i = inv.find(x => x.id === b.dataset.id);
  const v = prompt("Stock real de " + i.nombre, i.stock); if (v === null) return;
  await updateDoc(doc(db,"inventario",i.id), {stock:+v || 0});
  const c = prompt("Consumo por garrafón", consumo[i.id] || 0); if (c !== null) await setDoc(doc(db,"config","consumo"), {[i.id]:+c || 0}, {merge:true});
};
$("gastosLista").onclick = async e => {
  const b = e.target.closest(".dg"); if (!b || !confirm("¿Eliminar este gasto?")) return;
  const g = gastos.find(x => x.id === b.dataset.id); await deleteDoc(doc(db,"gastos",g.id));
  if (g.itemId) try { await updateDoc(doc(db,"inventario",g.itemId), {stock:increment(-g.cantidad)}); } catch {}
};

pintarMarcas();
