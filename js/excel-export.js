// Exportación de productos desde Firestore a Excel
import * as XLSX from 'xlsx';

async function exportarProductos() {
  const snapshot = await db.collection('productos').get();
  const productos = snapshot.docs.map(doc => doc.data());

  const hoja = XLSX.utils.json_to_sheet(productos);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Productos');

  XLSX.writeFile(libro, 'productos.xlsx');
  alert('Exportación completada correctamente.');
}

document.getElementById('exportExcel').addEventListener('click', exportarProductos);