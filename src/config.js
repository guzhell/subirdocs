// Configuración del expediente. Para agregar o quitar socios o documentos,
// edita estas listas y vuelve a desplegar. El `id` se usa como nombre de
// carpeta en el almacenamiento: no lo cambies después de que haya archivos.

export const ORG_NAME = "MSTRPLN";
export const ZIP_ROOT = "MSTRPLN_Acta_Constitutiva";

export const MEMBERS = [
  { id: "mario-ivan", name: "Mario Iván" },
  { id: "cuitlahuac", name: "Cuitláhuac" },
  { id: "jonathan", name: "Jonathan" },
  { id: "adrian", name: "Adrián" },
  { id: "gustavo", name: "Gustavo" },
  { id: "cesar", name: "César" },
];

export const DOCUMENTS = [
  { id: "ine-frente", name: "INE (frente)", hint: "Foto o escaneo legible, vigente.", required: true },
  { id: "ine-reverso", name: "INE (reverso)", hint: "Del mismo lado que tiene el código de barras.", required: true },
  { id: "curp", name: "CURP", hint: "Formato descargado de gob.mx/curp.", required: true },
  { id: "csf", name: "Constancia de Situación Fiscal", hint: "Emitida por el SAT, de preferencia del mes en curso.", required: true },
  { id: "domicilio", name: "Comprobante de domicilio", hint: "Luz, agua, teléfono o predial. No mayor a 3 meses.", required: true },
  { id: "acta-nacimiento", name: "Acta de nacimiento", hint: "Copia certificada o formato descargado de gob.mx.", required: true },
  { id: "acta-matrimonio", name: "Acta de matrimonio", hint: "Solo si eres casado. Debe indicar el régimen matrimonial.", required: false },
];

export const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB por archivo

export const ALLOWED_TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/webp": "webp",
};
