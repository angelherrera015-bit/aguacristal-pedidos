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

let llamadaN = null;
async function llamada(n) {
  llamadaN = n;
  const s = await getDoc(doc(db, "clientes", n)), c = s.exists() ? s.data() : null, nom = c ? [c.nombre, c.apellido].filter(Boolean).join(" ") || "Cliente sin nombre" : "Cliente nuevo";
  $("llamada").hidden = false; $("llamada").innerHTML = `📞 <b>${esc(nom)}</b> · ${n} <button class="btn" id="btnLl">Cargar pedido</button>`;
  navigator.vibrate?.(400);
  if (!$("tel").value && Object.values(cant).every(v => !v)) cargarLlamada();
}
function cargarLlamada() {
  document.querySelector('nav button[data-t="pedido"]').click(); setTipo("domicilio");
  $("tel").value = llamadaN; buscar(); $("llamada").hidden = true;
}
$("llamada").onclick = e => { if (e.target.id === "btnLl") cargarLlamada(); };

/* ---------- Ventas y metas ---------- */
function iniciar() {
  $("dia").value = $("dia2").value = hoy(); $("dia").max = $("dia2").max = hoy(); $("dia").onchange = $("dia2").onchange = $("perTipo").onchange = cargarRes; cargarRes();
  $("inputsMeta").innerHTML = [1,2,3,4,5,6].map(d => `<label>${DIAS[d]}<input type="number" min="0" data-d="${d}"></label>`).join("");
  onSnapshot(doc(db, "config", "consumo"), s => { consumo = s.exists() ? s.data() : {}; pintarAdmin(); });
  onSnapshot(collection(db, "inventario"), s => { inv = s.docs.map(d => ({id:d.id, ...d.data()})); pintarStock(); });
  if (rol === "maestro") iniciarAdmin();
  onSnapshot(doc(db, "config", "metas"), s => { metas = s.exists() ? {...METAS0, ...s.data()} : {...METAS0}; pintar(); });
  onSnapshot(query(collection(db, "pedidos"), where("fecha", ">=", lunes())), s => {
    pedidos = s.docs.map(d => ({id:d.id, ...d.data()})); pintar();
  });
  let primeraLl = true;
  onSnapshot(collection(db, "llamadas"), s => {
    if (primeraLl) { primeraLl = false; return; }
    s.docChanges().forEach(c => { if (c.type !== "added") return; const n = String(c.doc.data().tel || "").replace(/\D/g, "").slice(-8); if (n.length === 8) llamada(n); deleteDoc(c.doc.ref).catch(() => {}); });
  });
  const tp = new URLSearchParams(location.search).get("tel");
  if (tp) {
    const n = tp.replace(/\D/g, "").slice(-8);
    if (n.length === 8) { document.querySelector('nav button[data-t="pedido"]').click(); setTipo("domicilio"); $("tel").value = n; buscar(); }
    history.replaceState(null, "", location.pathname);
  }
}
function suma(arr) { return arr.reduce((a,p) => a + p.cantidad, 0); }
function pintar() {
  const t = new Date(), meta = metas[t.getDay()] || 0, hechos = suma(pedidos.filter(p => p.fecha === hoy()));
  const semMeta = [1,2,3,4,5,6].reduce((s,k) => s + (+metas[k] || 0), 0), semHechos = suma(pedidos);
  const bloque = (tit, h, m, ok, falta) => `<div class="card"><h3>${tit}</h3><div class="barra"><i style="width:${m ? Math.min(100, h/m*100) : 0}%"></i></div>
    <b>${h} de ${m}</b><p>${m === 0 ? "Hoy no hay meta." : h >= m ? ok : `Faltan ${m - h} ${falta}`}</p></div>`;
  $("metaHoy").innerHTML = bloque("Meta de hoy", hechos, meta, "¡Felicidades, cumplieron la meta de hoy!", "garrafones para cumplir la meta de hoy.");
  $("metaSem").innerHTML = bloque("Meta de la semana", semHechos, semMeta, "¡Felicidades, esta semana cumplieron la meta!", "garrafones para cumplir la meta de la semana.");
  document.querySelectorAll("#inputsMeta input").forEach(i => { if (document.activeElement !== i) i.value = metas[i.dataset.d]; });
}
let pedRes = [], unsubRes = null;
const lunesDe = d => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return fecha(x); };
function rango() {
  const t = $("perTipo").value, d = $("dia").value || hoy(), ym = d.slice(0,7), fin = fecha(new Date(+d.slice(0,4), +d.slice(5,7), 0));
  if (t === "semana") { const l = lunesDe(d); return [l, fecha(new Date(new Date(l + "T12:00:00").getTime() + 6*864e5))]; }
  if (t === "quincena") return +d.slice(8) <= 15 ? [ym + "-01", ym + "-15"] : [ym + "-16", fin];
  if (t === "mes") return [ym + "-01", fin];
  if (t === "rango") return [d, $("dia2").value || d].sort();
  return [d, d];
}
function cargarRes() {
  const [a,b] = rango(); $("dia2").hidden = $("perTipo").value !== "rango";
  if (unsubRes) unsubRes();
  unsubRes = onSnapshot(query(collection(db, "pedidos"), where("fecha", ">=", a), where("fecha", "<=", b)), s => { pedRes = s.docs.map(d => ({id:d.id, ...d.data()})); pintarRes(); });
}
function filasDia(del) {
  return [...new Set(del.map(p => p.fecha))].sort().map(x => { const d = del.filter(p => p.fecha === x), l = suma(d.filter(p => p.tipo === "local")), dm = suma(d.filter(p => p.tipo === "domicilio"));
    return {fecha:x, l, dm, t:l + dm, q:d.reduce((s,p) => s + p.total, 0), meta:metas[new Date(x + "T12:00:00").getDay()] || 0}; });
}
function pintarRes() {
  const [a,b] = rango(), tipo = $("perTipo").value, del = [...pedRes].sort((x,y) => (y.fecha + y.hora).localeCompare(x.fecha + x.hora));
  const loc = del.filter(p => p.tipo === "local"), dom = del.filter(p => p.tipo === "domicilio"), q = r => r.reduce((s,p) => s + p.total, 0);
  $("perTxt").textContent = a === b ? "Día: " + a : `Del ${a} al ${b}`;
  $("resumen").innerHTML = `<div class="kpi"><div><b>${suma(loc)}</b>Local · Q${q(loc)}</div><div><b>${suma(dom)}</b>Domicilio · Q${q(dom)}</div><div><b>${suma(del)}</b>Total · Q${q(del)}</div></div>` +
    (tipo === "dia" ? `<p>Entregados: ${del.filter(p => p.entregado).length}/${del.length}</p>` : `<div class="scroll"><table><tr><th>Fecha</th><th>Local</th><th>Domicilio</th><th>Total</th><th>Ingreso</th><th>Meta</th></tr>` +
      filasDia(del).map(r => `<tr><td>${r.fecha}</td><td>${r.l}</td><td>${r.dm}</td><td>${r.t}${r.meta && r.t >= r.meta ? " ✅" : ""}</td><td>Q${r.q}</td><td>${r.meta}</td></tr>`).join("") + `</table></div>`);
  $("lista").innerHTML = tipo !== "dia" ? "" : del.map(p => `<div class="ped ${p.entregado ? "ok" : ""}">
    <input type="checkbox" data-id="${p.id}" ${p.entregado ? "checked" : ""}>
    <div class="info"><b>${p.tipo === "local" ? "🏪 Local" : "🛵 " + esc(p.nombre || "Sin nombre")}</b> · ${p.hora.slice(0,5)}<br>${p.tipo === "domicilio" ? esc(p.direccion) + " · " + esc(p.tel) + "<br>" : ""}${mix(p.items)} · Q${p.total}</div>
    <span class="solo-maestro"><button data-id="${p.id}" class="ed">✏️</button><button data-id="${p.id}" class="del">🗑️</button></span></div>`).join("") || "<p>Sin pedidos este día.</p>";
}
$("btnAdd").onclick = async () => {
  if ($("perTipo").value !== "dia") return alert("Elige el modo Día y la fecha a la que quieres agregar ventas.");
  const f = $("dia").value || hoy();
  const loc = +prompt(`Ventas del ${f}: garrafones en LOCAL que faltan registrar (0 si ninguno)`, 0) || 0;
  const dom = +prompt(`Ventas del ${f}: garrafones a DOMICILIO que faltan registrar (0 si ninguno)`, 0) || 0;
  if (loc <= 0 && dom <= 0) return;
  const desc = confirm("¿Descontar tapones y sellos del inventario por estas ventas?");
  for (const [t,c] of [["local",loc],["domicilio",dom]]) if (c > 0) {
    await setDoc(doc(db,"pedidos",`man-${f}-${t}-${Date.now()}`), {tipo:t, items:{}, cantidad:c, total:c * PRECIO[t], entregado:true, fecha:f, hora:"00:00:00", por:auth.currentUser.email, ts:serverTimestamp(), tel:"", nombre:"Ventas agregadas", direccion:"", manual:true});
    if (desc) await moverStock(c, -1);
  }
};
$("lista").onclick = async e => {
  const b = e.target.closest("button"); if (!b) return;
  const ref = doc(db, "pedidos", b.dataset.id);
  if (b.classList.contains("del") && confirm("¿Eliminar este pedido?")) { const p = [...pedRes, ...pedidos].find(x => x.id === b.dataset.id); await deleteDoc(ref); if (p) await moverStock(p.cantidad, 1); }
  if (b.classList.contains("ed")) {
    const p = [...pedRes, ...pedidos].find(x => x.id === b.dataset.id);
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
$("btnExcel").onclick = () => {
  const [a,b] = rango(), del = [...pedRes].sort((x,y) => (x.fecha + x.hora).localeCompare(y.fecha + y.hora)), wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasDia(del).map(r => ({Fecha:r.fecha, Local:r.l, Domicilio:r.dm, Total:r.t, "Ingreso Q":r.q, Meta:r.meta}))), "Resumen por día");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(del.map(p => ({Fecha:p.fecha, Hora:p.hora, Tipo:p.tipo, Cliente:p.nombre, Teléfono:p.tel, Dirección:p.direccion,
    Salvavidas:p.items.salvavidas || 0, Scandia:p.items.scandia || 0, Carrera:p.items.carrera || 0, "Sin marca":p.items.sinmarca || 0, Garrafones:p.cantidad, "Total Q":p.total, Entregado:p.entregado ? "Sí" : "No", Registró:p.por}))), "Pedidos");
  XLSX.writeFile(wb, `ventas-agua-cristal-${a}_a_${b}.xlsx`);
};

/* ---------- Hojas 4 a 7 (solo administrador): gastos, semanas, pendientes y registro ---------- */
const P = (id, n, m, c, x = {}) => ({id, n, m, c, ...x});
const PLAN0 = [P("repartidor","Sueldo repartidor",4000*6/26,1,{sem:true}), P("operadora","Sueldo operadora",3500*6/26,1,{sem:true}), P("alquiler","Alquiler del local",1500,1,{d1:10,d2:15}), P("agua","Agua",1000,1,{d1:20,d2:25}), P("luz","Luz",200,1,{d1:20,d2:25}), P("internet","Internet",100,1,{fijo:true}), P("tapones","Tapones y sellos",420,1), P("gasolina","Gasolina de la moto",300,1), P("imprevistos","Daños o imprevistos (tubería y moto)",400,1), P("sal","Sal Morton",230,3), P("jabon","Jabón para lavar tambos",80,6), P("acido","Ácido limpia tubos",275,4), P("lampara","Lámpara UV y ozono",2000,12), P("filtro","Filtro",110,3), P("servicio","Servicio de la moto",150,2), P("bono","Bono 14 y aguinaldo (2 empleados x Q2,800 x 2 veces al año)",11200,12)];
let plan = PLAN0, consumo = {}, inv = [], gastos = [], pedAdm = [];
const PROM = 9.72, SEM_MES = 26 / 6;
const Q = n => "Q" + (+n).toLocaleString("es-GT",{minimumFractionDigits:2,maximumFractionDigits:2});
const mensual = p => p.sem ? p.m * SEM_MES : p.m / p.c, totalMes = () => plan.reduce((s,p) => s + mensual(p), 0), equilibrio = () => Math.ceil(totalMes() / 26 / PROM);
const FONDO_DESDE = "2026-11";
const G_SEM = "Pagos semanales (sueldos)", G_FIJO = "Fijos del mes", G_INS = "Insumos e imprevistos (al terminarse)", G_PRO = "Prorrateados: apartar cada mes";
const grupo = p => p.sem ? G_SEM : p.c > 1 ? G_PRO : (p.d1 || p.fijo) ? G_FIJO : G_INS;
const totGrupo = n => plan.filter(p => grupo(p) === n).reduce((s,p) => s + mensual(p), 0);
const cuando = p => p.sem ? "Cada semana" : p.c > 1 ? `Cada ${p.c} meses` : p.d1 ? `Del ${p.d1} al ${p.d2}` : p.fijo ? "Cada mes" : "Al terminarse";
const guardarPlan = items => setDoc(doc(db,"privado","plan"), {items:JSON.parse(JSON.stringify(items))});
const migrar = i => { const b = PLAN0.find(x => x.id === i.id); if (!b) return i; return b.sem && i.sem === undefined ? {...b, ...i, sem:true, m:i.m / SEM_MES} : {d1:b.d1, d2:b.d2, fijo:b.fijo, ...i}; };
const sumaG = a => a.reduce((s,g) => s + g.monto, 0), mesDe = f => f.slice(0,7), mi = s => +s.slice(0,4) * 12 + +s.slice(5,7);
const sumaDia = (f,n) => { const d = new Date(f + "T12:00:00"); d.setDate(d.getDate() + n); return fecha(d); };
async function moverStock(n, signo) {
  for (const [id,c] of Object.entries(consumo)) if (c > 0) try { await updateDoc(doc(db,"inventario",id), {stock:increment(signo*n*c)}); } catch {}
}
function semana(l) {
  const f = sumaDia(l,6), ped = pedAdm.filter(p => p.fecha >= l && p.fecha <= f), gs = gastos.filter(g => g.fecha >= l && g.fecha <= f).sort((a,b) => a.fecha.localeCompare(b.fecha));
  const dias = l === lunes() ? Math.min(6, new Date().getDay() || 6) : 6;
  const ing = ped.reduce((s,p) => s + p.total, 0), need = totalMes() / SEM_MES * dias / 6;
  return {gs, gar:suma(ped), ing, need, dias, pag:sumaG(gs), dif:ing - need};
}
function filasPend(m) {
  return plan.filter(p => !p.sem).map(p => {
    const mine = gastos.filter(g => g.planId === p.id), hecho = mine.filter(g => mesDe(g.fecha) === m);
    const prev = mine.filter(g => mesDe(g.fecha) < m).map(g => mesDe(g.fecha)).sort().pop();
    return {p, hecho, prev, toca:p.c === 1 || !prev || mi(m) - mi(prev) >= p.c || hecho.length > 0};
  }).filter(x => x.toca);
}
function pintarStock() {
  $("stockBox").innerHTML = `<div class="card"><h3>Stock de tapones y sellos</h3>` + ["tapones","sellos"].map(id => { const i = inv.find(x => x.id === id);
    return i ? `<p><b>${esc(i.nombre)}:</b> ${Math.max(0, Math.round(i.stock))} ${i.stock <= i.minimo ? "⚠️ por agotarse, avisar al administrador" : ""}</p>` : ""; }).join("") + `</div>`;
  pintarAdmin();
}
async function sembrar() {
  for (const [id,n] of [["tapones","Tapones"],["sellos","Sellos"]]) { const r = doc(db,"inventario",id); if (!(await getDoc(r)).exists()) await setDoc(r, {nombre:n, unidad:"unidades", stock:0, minimo:100}); }
  const r = doc(db,"config","consumo"), s = await getDoc(r), c = s.exists() ? s.data() : {};
  if (c.tapones === undefined || c.sellos === undefined) await setDoc(r, {tapones:c.tapones ?? 1, sellos:c.sellos ?? 1}, {merge:true});
}
function iniciarAdmin() {
  $("pendMes").value = hoy().slice(0,7); $("pendMes").onchange = pintarPend; $("rFecha").value = hoy();
  onSnapshot(doc(db,"privado","plan"), s => { plan = s.exists() ? s.data().items.map(migrar) : PLAN0; pintarAdmin(); });
  onSnapshot(collection(db,"gastos"), s => { gastos = s.docs.map(d => ({id:d.id, ...d.data()})); pintarAdmin(); });
  onSnapshot(query(collection(db,"pedidos"), where("fecha",">=",sumaDia(lunes(),-84))), s => { pedAdm = s.docs.map(d => d.data()); pintarAdmin(); });
  sembrar();
}
function pintarAdmin() { if (rol !== "maestro") return; pintarGastos(); pintarSemanas(); pintarPend(); pintarRegistro(); }
function pintarGastos() {
  const mes = hoy().slice(0,7), pag = id => sumaG(gastos.filter(g => g.planId === id && mesDe(g.fecha) === mes));
  const tabla = n => { const f = plan.filter(p => grupo(p) === n); return f.length ? `<h3>${n}</h3><table><tr><th>Concepto</th><th>Pago</th><th>Cuándo</th><th>Mensual</th><th>Pagado este mes</th><th></th></tr>` +
    f.map(p => `<tr><td>${esc(p.n)}</td><td>${Q(p.m)}${p.sem ? " / semana" : ""}</td><td>${cuando(p)}</td><td>${Q(mensual(p))}</td><td>${Q(pag(p.id))}</td><td><button data-id="${p.id}" class="ep">✏️</button></td></tr>`).join("") +
    `<tr><th colspan="3">Subtotal</th><th>${Q(totGrupo(n))}</th><th></th><th></th></tr></table>` : ""; };
  const pagos = totalMes() - totGrupo(G_PRO), ids = plan.filter(p => grupo(p) === G_PRO).map(p => p.id);
  const apartado = totGrupo(G_PRO) * Math.max(mi(mes) - mi(FONDO_DESDE) + 1, 0), usado = sumaG(gastos.filter(g => ids.includes(g.planId) && mesDe(g.fecha) >= FONDO_DESDE));
  $("gastosTabla").innerHTML = `<div class="card"><h3>Resumen mensual</h3><p>Pagos del mes (sueldos, fijos e insumos): <b>${Q(pagos)}</b></p><p>🔒 Reserva prorrateada que debes apartar este mes: <b>${Q(totGrupo(G_PRO))}</b></p><p>Fondo prorrateado (desde nov 2026): a fin de este mes debes tener apartados <b>${Q(apartado)}</b> · usado en compras ${Q(usado)} · saldo <b>${Q(apartado - usado)}</b></p><p>Total mensual: <b>${Q(totalMes())}</b> · Semanal: ${Q(totalMes() / SEM_MES)} · Diario: ${Q(totalMes() / 26)}</p><p>Equilibrio: <b>${equilibrio()}</b> garrafones al día. Pagado este mes: ${Q(sumaG(gastos.filter(g => mesDe(g.fecha) === mes)))}</p></div>` +
    [G_SEM, G_FIJO, G_INS, G_PRO].map(tabla).join("");
}
function pintarSemanas() {
  const sel = $("semSel");
  if (!sel.options.length) { for (let k = 0; k < 12; k++) { const l = sumaDia(lunes(), -7*k); sel.add(new Option("Semana del " + l, l)); } sel.onchange = pintarSemanas; }
  const s = semana(sel.value), meta = [1,2,3,4,5,6].reduce((t,k) => t + (+metas[k] || 0), 0);
  $("semDet").innerHTML = `<div class="card"><h3>${s.dias < 6 ? "Semana en curso (" + s.dias + " de 6 días): " : ""}${s.dif >= 0 ? "✅ Cubre los gastos" : "❌ No cubre los gastos"}</h3>
    <p>${s.dif >= 0 ? "Sobraron " : "Faltaron "}<b>${Q(Math.abs(s.dif))}</b> frente al gasto necesario de ${Q(s.need)}${s.dias < 6 ? " para los días que van" : " (gasto mensual ÷ 4.33)"}.</p></div>
    <div class="kpi"><div><b>${s.gar}</b>Garrafones (meta ${meta})</div><div><b>${Q(s.ing)}</b>Ingresos</div><div><b>${Q(s.pag)}</b>Pagado</div></div>
    <div class="card"><h3>Pagos de la semana</h3>${s.gs.map(g => `<p>${g.fecha} · ${esc(g.concepto)} · <b>${Q(g.monto)}</b></p>`).join("") || "<p>Sin pagos registrados.</p>"}
    <p>Ingresos menos pagos de la semana: <b>${Q(s.ing - s.pag)}</b></p></div>
    <div class="card"><h3>Sueldos de la semana</h3>${plan.filter(p => p.sem).map(p => { const h = s.gs.filter(g => g.planId === p.id); return `<p>${h.length ? "✅" : "⏳"} ${esc(p.n)}: ${h.length ? "pagado " + Q(sumaG(h)) : "pendiente " + Q(p.m)}</p>`; }).join("")}</div>`;
}
function pintarPend() {
  const m = $("pendMes").value || hoy().slice(0,7), f = filasPend(m), pend = f.filter(x => !x.hecho.length), dia = new Date().getDate(), actual = m === hoy().slice(0,7);
  const estado = x => x.hecho.length ? "✅ Pagado " + Q(sumaG(x.hecho)) : "⏳ Pendiente · aprox. " + Q(x.p.m) + (x.p.d1 ? " · se paga del " + x.p.d1 + " al " + x.p.d2 : " · al terminarse") +
    (actual && x.p.d1 ? (dia > x.p.d2 ? " · ⚠️ pasó la fecha usual" : dia >= x.p.d1 ? " · ⏰ toca pagar ahora" : "") : "") + (!x.prev && x.p.c > 1 ? " · sin compra registrada" : "");
  $("pendDet").innerHTML = `<div class="card"><h3>Pendiente de pagar o comprar</h3><b>${Q(pend.reduce((s,x) => s + x.p.m, 0))}</b> aproximado · ${pend.length} de ${f.length} conceptos que tocan este mes (los sueldos se ven en Semanas)</div>` +
    f.map(x => `<div class="ped ${x.hecho.length ? "ok" : ""}"><div class="info"><b>${esc(x.p.n)}</b><br>${estado(x)}</div></div>`).join("") +
    `<div class="card"><h3>Stock</h3>` + ["tapones","sellos"].map(id => { const i = inv.find(x => x.id === id); return i ? `<div class="ped ${i.stock <= i.minimo ? "bajo" : ""}"><div class="info"><b>${esc(i.nombre)}</b>: ${Math.round(i.stock)} · avisar en ${i.minimo}</div><button data-id="${id}" class="aj">✏️</button></div>` : ""; }).join("") + `</div>`;
}
function pintarRegistro() {
  const sel = $("rSel");
  if (sel.options.length !== plan.length + 1) sel.innerHTML = plan.map(p => `<option value="${p.id}">${esc(p.n)}</option>`).join("") + `<option value="otro">Otro gasto / imprevisto</option>`;
  $("rConc").hidden = sel.value !== "otro"; $("rTapDiv").hidden = sel.value !== "tapones";
  const mes = hoy().slice(0,7);
  $("regLista").innerHTML = gastos.filter(g => mesDe(g.fecha) === mes).sort((a,b) => b.fecha.localeCompare(a.fecha)).map(g => `<div class="ped"><div class="info">${g.fecha} · <b>${esc(g.concepto)}</b> · ${Q(g.monto)}</div><button data-id="${g.id}" class="dg">🗑️</button></div>`).join("") || "<p>Sin pagos este mes.</p>";
}
$("rSel").onchange = () => { const p = plan.find(x => x.id === $("rSel").value); $("rMonto").value = p ? +p.m.toFixed(2) : ""; pintarRegistro(); };
$("btnReg").onclick = async () => {
  const id = $("rSel").value, monto = +$("rMonto").value, p = plan.find(x => x.id === id), concepto = id === "otro" ? $("rConc").value.trim() : p.n;
  if (!(monto > 0) || !concepto) return alert("Escribe el monto" + (id === "otro" ? " y el concepto." : "."));
  const g = {fecha:$("rFecha").value || hoy(), planId:id, concepto, monto, por:auth.currentUser.email, ts:serverTimestamp()};
  const tap = +$("rTap").value || 0, sello = +$("rSello").value || 0;
  if (id === "tapones") Object.assign(g, {tap, sel:sello});
  await addDoc(collection(db,"gastos"), g);
  if (tap) await updateDoc(doc(db,"inventario","tapones"), {stock:increment(tap)});
  if (sello) await updateDoc(doc(db,"inventario","sellos"), {stock:increment(sello)});
  ["rMonto","rConc","rTap","rSello"].forEach(i => $(i).value = "");
};
$("regLista").onclick = async e => {
  const b = e.target.closest(".dg"); if (!b || !confirm("¿Eliminar este pago?")) return;
  const g = gastos.find(x => x.id === b.dataset.id); await deleteDoc(doc(db,"gastos",g.id));
  if (g.tap) await updateDoc(doc(db,"inventario","tapones"), {stock:increment(-g.tap)});
  if (g.sel) await updateDoc(doc(db,"inventario","sellos"), {stock:increment(-g.sel)});
};
$("pendDet").onclick = async e => {
  const b = e.target.closest(".aj"); if (!b) return; const i = inv.find(x => x.id === b.dataset.id);
  const v = prompt("Stock real de " + i.nombre, Math.round(i.stock)); if (v === null) return;
  const m = prompt("Avisar cuando queden", i.minimo); await updateDoc(doc(db,"inventario",i.id), {stock:+v || 0, minimo:+m || 0});
};
$("gastosTabla").onclick = async e => {
  const b = e.target.closest(".ep"); if (!b) return; const p = plan.find(x => x.id === b.dataset.id);
  const m = prompt(p.sem ? `Pago semanal de "${p.n}" (Q)` : `Monto de "${p.n}" (Q)`, +p.m.toFixed(2)); if (m === null) return;
  let c = p.c, v = p.d1 ? p.d1 + "-" + p.d2 : "";
  if (!p.sem) { c = prompt("Cada cuántos meses se paga (1 = mensual)", p.c); if (c === null) return; v = prompt("Fechas usuales de pago, ej. 10-15 (vacío = sin fecha)", v); if (v === null) return; }
  const [d1, d2] = v.split("-").map(Number);
  await guardarPlan(plan.map(x => x.id === p.id ? {...x, m:+m || 0, c:+c || 1, d1:d1 || null, d2:d2 || d1 || null} : x));
};
$("btnPlus").onclick = async () => {
  const n = prompt("Concepto nuevo"); if (!n) return; const m = +prompt("Monto Q") || 0, c = +prompt("Cada cuántos meses (1 = mensual)", 1) || 1;
  await guardarPlan([...plan, {id:"x" + Date.now(), n, m, c}]);
};
$("btnExp").onclick = () => {
  const wb = XLSX.utils.book_new(), add = (n, r) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(r), n), m = $("pendMes").value || hoy().slice(0,7);
  add("4 Gastos mensuales", [...plan.map(p => ({Concepto:p.n, "Monto Q":p.m, "Cada (meses)":p.c, "Mensual Q":+mensual(p).toFixed(2), Grupo:grupo(p), Cuándo:cuando(p)})), {Concepto:"RESERVA PRORRATEADA A APARTAR", "Mensual Q":+totGrupo(G_PRO).toFixed(2)}, {Concepto:"TOTAL MENSUAL", "Mensual Q":+totalMes().toFixed(2)}]);
  add("5 Semanas", Array.from({length:12}, (_,k) => { const l = sumaDia(lunes(), -7*k), s = semana(l); return {Semana:l, Garrafones:s.gar, "Ingresos Q":s.ing, "Gasto semanal necesario Q":+s.need.toFixed(2), "Pagado Q":s.pag, Resultado:s.dif >= 0 ? "Cubrió" : "No cubrió"}; }));
  add("6 Pendientes " + m, filasPend(m).map(x => ({Concepto:x.p.n, Estado:x.hecho.length ? "Pagado" : "Pendiente", "Monto Q":x.hecho.length ? sumaG(x.hecho) : x.p.m})));
  add("7 Registro", [...gastos].sort((a,b) => a.fecha.localeCompare(b.fecha)).map(g => ({Fecha:g.fecha, Concepto:g.concepto, "Monto Q":g.monto, Registró:g.por})));
  XLSX.writeFile(wb, `gastos-agua-cristal-${hoy()}.xlsx`);
};
const HIST = [["2026-10-19",26,39],["2026-10-20",8,39],["2026-10-21",14,35],["2026-10-22",11,30],["2026-10-23",14,30],["2026-10-24",14,47],["2026-10-26",15,36],["2026-10-27",21,45],["2026-10-28",14,39],["2026-10-29",18,41],["2026-10-30",16,31],["2026-10-31",6,51],["2026-11-02",14,46],["2026-11-03",22,36],["2026-11-04",11,34],["2026-11-05",15,34],["2026-11-06",8,32],["2026-11-07",13,51],["2026-11-09",22,43],["2026-11-10",10,58],["2026-11-11",21,52],["2026-11-12",13,41],["2026-11-13",4,43]];
const HIST_G = [{id:"moto-alquiler", fecha:"2026-11-09", planId:"otro", concepto:"Alquiler de moto (lunes a sábado)", monto:450}, {id:"moto-gasolina", fecha:"2026-11-12", planId:"gasolina", concepto:"Gasolina de la moto", monto:100}, {id:"moto-gas-1311", fecha:"2026-11-13", planId:"gasolina", concepto:"Gasolina de la moto", monto:25}];
$("btnImp").onclick = async () => {
  if (!confirm("¿Importar las ventas del 19/10 al 13/11 y los gastos de la moto? Puedes repetirlo sin duplicar.")) return;
  let n = 0;
  for (const [f,loc,dom] of HIST) for (const [t,c] of [["local",loc],["domicilio",dom]]) {
    const real = pedAdm.filter(p => p.fecha === f && p.tipo === t && !p.importado).reduce((s,p) => s + p.cantidad, 0), falta = c - real, id = `imp-${f}-${t}`;
    if (falta <= 0) { try { await deleteDoc(doc(db,"pedidos",id)); } catch {} continue; }
    await setDoc(doc(db,"pedidos",id), {tipo:t, items:{}, cantidad:falta, total:falta * PRECIO[t], entregado:true, fecha:f, hora:"00:00:00", por:"importado", ts:serverTimestamp(), tel:"", nombre:"Histórico", direccion:"", importado:true});
    n++;
  }
  for (const {id, ...g} of HIST_G) await setDoc(doc(db,"gastos","imp-" + id), {...g, por:"importado", ts:serverTimestamp()});
  alert(`Listo: ${n} registros de ventas y ${HIST_G.length} gastos importados.`);
};

pintarMarcas();
