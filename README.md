# entulínea ProPoints

Reconstrucción personal del sistema ProPoints de entulínea/Weight Watchers España (~2011-2017), con DAS/DNC (Días de No Contar), Extra semanal y calculadora manual.

App estática, sin backend. Datos guardados en el navegador (localStorage).

## Uso local

```bash
python3 -m http.server 8000
```

Abrir http://localhost:8000

## Despliegue en GitHub Pages

1. Subir este repo a GitHub.
2. Settings → Pages → Deploy from branch → `main` / `(root)`.
3. La app queda disponible en `https://<usuario>.github.io/<repo>/`.

## Configuración fijada

- Capital diario: 29 PP (calculado con la fórmula histórica verificada, para 168cm/90kg/44a)
- Extra semanal: 49 PP, fijo
- Reset: capital diario cada día a las 00:00; extra semanal cada lunes
- Orden de descuento: capital diario primero, extra semanal después (excepto en día DNC, donde los alimentos no saciantes van directos al extra)

## Datos

`data/alimentos.json` — 757 alimentos reconstruidos a partir de fuentes históricas (blogs y foros de la época, ~2013-2014), con nombre, categoría, ración, PP, si es saciante para DNC, fuente y confianza. Ver investigación completa y fuentes citadas en el histórico de la conversación que originó este proyecto.

## Fórmulas

- ProPoints por alimento: `ROUND(proteína/10 + carbohidratos/10 + grasa/4 + fibra/30)`
- Capital diario (mujeres): `min(max(round((altura_in-48)/2 + peso_lb×0.1461 - (edad-21)/5 - 5), 29), 71)`
