/**
 * Paquet d'application pour l'« URL Launcher » des télés Samsung (SSSP / Tizen).
 *
 * L'URL Launcher n'ouvre pas une page : il lit <adresse>/sssp_config.xml, puis
 * télécharge et installe <adresse>/<widgetname>.wgt. Ce paquet est une mini
 * application Tizen qui ouvre l'écran de l'atelier (/display) en plein écran.
 *
 * Le paquet est construit à la volée pour l'adresse demandée (l'application
 * renvoie vers le même serveur), au format ZIP sans compression.
 */
import { crc32, inflateRawSync } from 'node:zlib';

export const WIDGET_NAME = 'InterfasDisplay';
/** À augmenter quand le contenu du paquet change : la télé réinstalle alors l'application. */
export const WIDGET_VERSION = '1.0.2';
/** Version annoncée pour un paquet signé dont le config.xml est illisible. */
export const SIGNED_VERSION = '1.0.1';

/** Nom d'hôte (et port) acceptable dans l'adresse de l'écran. */
const HOST_RE = /^[a-z0-9.-]+(:\d{1,5})?$/i;
export const validHost = (host: string) => HOST_RE.test(host) && host.length <= 253;

export function configXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" id="http://interfas.fr/${WIDGET_NAME}" version="${WIDGET_VERSION}" viewmodes="maximized">
  <tizen:application id="IntfsDispl.${WIDGET_NAME}" package="IntfsDispl" required_version="2.3"/>
  <tizen:profile name="tv-samsung"/>
  <content src="index.html"/>
  <icon src="icon.png"/>
  <name>Interfas Display</name>
  <access origin="*" subdomains="true"/>
  <tizen:allow-navigation>*</tizen:allow-navigation>
  <tizen:privilege name="http://tizen.org/privilege/internet"/>
  <tizen:setting hwkey-event="enable"/>
</widget>
`;
}

/*
 * Page de démarrage. Les télés appliquent une politique de sécurité qui
 * interdit le style et le script écrits dans la page : ils sont dans des
 * fichiers séparés (style.css, main.js).
 */
export function indexHtml(): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Interfas Display</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<p id="msg">Connexion à l'écran de l'atelier…</p>
<script src="main.js"></script>
</body>
</html>
`;
}

export const STYLE_CSS = `html,body{margin:0;height:100%;background:#221B13;color:#E7E3D8;font-family:sans-serif}
body{display:flex;align-items:center;justify-content:center;font-size:2.5vw}
`;

/** Ouvre l'écran ; nouvel essai toutes les 30 s si le serveur ne répond pas. */
export function mainJs(target: string): string {
  return `(function () {
  var target = ${JSON.stringify(target)};
  // Test de présence du serveur par une image (pas de contrainte CORS), puis ouverture de l'écran.
  var probe = ${JSON.stringify(target + '/ping.gif')};
  function go() {
    var img = new Image();
    var done = false;
    var timer = setTimeout(function () { fail(); }, 10000);
    function fail() {
      if (done) return;
      done = true;
      document.getElementById('msg').textContent = 'Serveur injoignable (' + target + '), nouvel essai dans 30 s…';
      setTimeout(go, 30000);
    }
    img.onload = function () { if (done) return; done = true; clearTimeout(timer); location.replace(target); };
    img.onerror = function () { clearTimeout(timer); fail(); };
    img.src = probe + '?t=' + Date.now();
  }
  go();
})();
`;
}

/* --- ZIP minimal (méthode « stored ») --- */

function dosDateTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export function zipStored(files: { name: string; data: Buffer }[], when = new Date(2026, 0, 1)): Buffer {
  const { time, date } = dosDateTime(when);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version nécessaire
    local.writeUInt16LE(0x0800, 6); // noms en UTF-8
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.data.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, f.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(f.data.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + f.data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

export function buildWidget(target: string, icon: Buffer): Buffer {
  return zipStored([
    { name: 'config.xml', data: Buffer.from(configXml()) },
    { name: 'index.html', data: Buffer.from(indexHtml()) },
    { name: 'style.css', data: Buffer.from(STYLE_CSS) },
    { name: 'main.js', data: Buffer.from(mainJs(target)) },
    { name: 'icon.png', data: icon },
  ]);
}

/** Lit un fichier d'un ZIP (stocké ou compressé), ou null. */
export function readZipEntry(zip: Buffer, wanted: string): Buffer | null {
  try {
    let end = -1;
    for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
      if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) return null;
    const count = zip.readUInt16LE(end + 10);
    let p = zip.readUInt32LE(end + 16);
    for (let n = 0; n < count; n++) {
      if (zip.readUInt32LE(p) !== 0x02014b50) return null;
      const method = zip.readUInt16LE(p + 10);
      const size = zip.readUInt32LE(p + 20);
      const nameLen = zip.readUInt16LE(p + 28);
      const extraLen = zip.readUInt16LE(p + 30);
      const commentLen = zip.readUInt16LE(p + 32);
      const local = zip.readUInt32LE(p + 42);
      const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
      if (name === wanted) {
        const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
        const data = zip.subarray(start, start + size);
        if (method === 0) return Buffer.from(data);
        if (method === 8) return inflateRawSync(data);
        return null;
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
  } catch {
    /* ZIP abîmé */
  }
  return null;
}

/** Version déclarée dans le config.xml d'un paquet (signé), pour que la télé installe chaque nouvelle version. */
export function packageVersion(wgt: Buffer): string {
  const cfg = readZipEntry(wgt, 'config.xml')?.toString('utf8') ?? '';
  const m = /<widget\b[^>]*\sversion="(\d+\.\d+\.\d+)"/.exec(cfg);
  return m ? m[1] : SIGNED_VERSION;
}

export function ssspConfig(size: number, version = WIDGET_VERSION): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<widget>
  <ver>${version}</ver>
  <size>${size}</size>
  <widgetname>${WIDGET_NAME}</widgetname>
  <webtype>tizen</webtype>
</widget>
`;
}
