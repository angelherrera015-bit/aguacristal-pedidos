import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,signInWithEmailAndPassword,signOut,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,collection,doc,getDoc,getDocs,setDoc,addDoc,updateDoc,deleteDoc,query,where,onSnapshot,serverTimestamp,arrayUnion} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
const METAS0 = {1:65,2:55,3:49,4:41,5:44,6:61};
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
      if (tel.length !== 8 || !nom || !dir) return alert("Faltan teléfono, nombre o dirección.");
      const c = { nombre:nom, apellido:ape, direcciones:arrayUnion(dir) };
      if ($("tel2").value.trim()) c.tel2 = $("tel2").value.trim();
      await setDoc(doc(db, "clientes", tel), c, {merge:true});
      Object.assign(p, {tel, nombre:(nom + " " + ape).trim(), direccion:dir});
    }
    await addDoc(collection(db, "pedidos"), p);
    if (tipo === "domicilio") imprimir(p);
    MARCAS.forEach(([k]) => cant[k] = 0);
    ["tel","nombre","apellido","dirNueva","tel2"].forEach(i => $(i).value = "");
    $("dirSel").hidden = true; $("estado").textContent = ""; cli = null; mostrarDir(); pintarMarcas();
  } catch (e) { alert("No se pudo guardar: " + e.message); }
};

function mix(it) { return MARCAS.filter(([k]) => it[k]).map(([k,n]) => `${it[k]} ${n}`).join(", "); }
function imprimir(p) {
  $("ticket").innerHTML = `<h2>AGUA CRISTAL</h2><p>${p.fecha} ${p.hora}</p><hr>
    <p><b>${esc(p.nombre)}</b><br>Tel: ${esc(p.tel)}<br>${esc(p.direccion)}</p><hr>
    ${MARCAS.filter(([k]) => p.items[k]).map(([k,n]) => `<p>${p.items[k]} x ${n}</p>`).join("")}
    <hr><p><b>Total: ${p.cantidad} garrafón(es) · Q${p.total}</b></p>`;
  setTimeout(() => window.print(), 200);
}

/* ---------- Ventas y metas ---------- */
function iniciar() {
  $("dia").value = hoy(); $("dia").min = lunes(); $("dia").max = hoy(); $("dia").onchange = pintar;
  $("inputsMeta").innerHTML = [1,2,3,4,5,6].map(d => `<label>${DIAS[d]}<input type="number" min="0" data-d="${d}"></label>`).join("");
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
    <div class="info"><b>${p.tipo === "local" ? "🏪 Local" : "🛵 " + esc(p.nombre)}</b> · ${p.hora.slice(0,5)}<br>${p.tipo === "domicilio" ? esc(p.direccion) + " · " + esc(p.tel) + "<br>" : ""}${mix(p.items)} · Q${p.total}</div>
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
  if (b.classList.contains("del") && confirm("¿Eliminar este pedido?")) await deleteDoc(ref);
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

pintarMarcas();
