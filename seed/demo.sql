-- Datos de demostración para desarrollo local. No usar en producción.
DELETE FROM passes;
DELETE FROM profiles;

INSERT INTO profiles (id, display_name, brand_color, data, created_at) VALUES
  ('pro_1', 'Estudio Demo', '#34d399',
   '{"bio":"Selección de obra reciente","media":[{"key":"obras/01.jpg","type":"image","caption":"Obra 1"},{"key":"obras/02.jpg","type":"image","caption":"Obra 2"},{"key":"obras/03.jpg","type":"image","caption":"Obra 3"},{"key":"obras/04.jpg","type":"image","caption":"Obra 4"}]}',
   unixepoch() * 1000),
  ('pro_2', 'Marina Ruiz · Fotografía', '#5b87b0',
   '{"bio":"Serie 2026","media":[{"key":"marina/01.jpg","type":"image","caption":"Serie 2026 I"},{"key":"marina/02.jpg","type":"image","caption":"Serie 2026 II"},{"key":"marina/03.jpg","type":"image","caption":"Serie 2026 III"}]}',
   unixepoch() * 1000);
