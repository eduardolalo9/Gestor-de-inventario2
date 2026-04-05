// Importación de productos desde Excel a Firestore
import * as XLSX from 'xlsx';

document.getElementById('importExcel').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const productos = XLSX.utils.sheet_to_json(sheet);

  const batch = db.batch();
  productos.forEach((producto) => {
    const ref = db.collection('productos').doc();
    batch.set(ref, {
      nombre: producto.Nombre,
      precio: producto.Precio,
      stock: producto.Stock,
      proveedor: producto.Proveedor,
      fechaActualizacion: firebase.firestore.FieldValue.serverTimestamp()
    });
  });

  await batch.commit();
  alert('Importación completada correctamente.');
});