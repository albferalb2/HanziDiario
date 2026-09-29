# Hanzi Diario

Aplicación web progresiva (PWA) en español para guardar vocabulario chino y practicar lectura de caracteres y frases. Se adapta a móvil y escritorio, puede instalarse desde el navegador y guarda el progreso en el dispositivo. Incluye las 300 palabras del nivel 1 del programa HSK 3.0.

## Funciones

- Inicio con racha, minutos de práctica, meta diaria y palabras aprendidas.
- Ejercicios de opción múltiple para caracteres y frases.
- Botón para mostrar u ocultar el pinyin durante la lectura.
- Apartado de escritura: traduce frases del español al chino y comprueba tu respuesta en hanzi.
- Práctica guiada de trazos para los caracteres individuales del HSK 1, con animación y dibujo táctil.
- Modo oscuro, con preferencia guardada en el dispositivo.
- Acceso con Google y sincronización entre dispositivos mediante Firebase Authentication y Cloud Firestore (requiere configurar un proyecto propio).
- Cuaderno para añadir, buscar, filtrar y marcar palabras aprendidas.
- Resumen semanal, nivel HSK y meta diaria configurable.
- Copia de seguridad JSON para mover el progreso a otro dispositivo.
- Interfaz sin dependencias de instalación; el progreso se guarda en el navegador.

## Uso

Sirve estos archivos desde un servidor web local o publícalos en un sitio con HTTPS. Para instalarla en el móvil, abre la web en el navegador y elige **Instalar aplicación**; en iPhone, usa **Compartir → Añadir a pantalla de inicio**.

Para ejecutar una copia del repositorio, duplica `firebase-config.example.js` con el nombre `firebase-config.js` y completa la configuración de tu app web de Firebase. El archivo real se ignora en Git. La API key de Firebase para la app web es pública por diseño; no pongas aquí claves secretas de otros servicios.

## Activar el acceso de Google y la sincronización

1. El proyecto Firebase `haznidiario` ya está identificado. En **Configuración del proyecto → General → Tus apps**, crea o abre la app web.
2. Crea `firebase-config.js` a partir de `firebase-config.example.js` y pega la configuración de tu app web. Usa `haznidiario.web.app` como `authDomain` para que el acceso por redirección funcione en navegadores móviles que bloquean almacenamiento entre dominios. Si cambias el dominio de Hosting, actualiza también este valor.
3. En **Authentication → Sign-in method**, activa Google.
4. En **Google Cloud Console → APIs y servicios → Credenciales**, añade esta URL a los **URI de redirección autorizados** del cliente OAuth web de Firebase: `https://haznidiario.web.app/__/auth/handler`.
5. Usa **Cloud Firestore** para el progreso y publica las reglas incluidas en `firestore.rules`. Solo permiten a una persona autenticada leer o modificar su documento de progreso.
6. En **Authentication → Settings → Authorized domains**, añade `haznidiario.web.app` y cualquier otro dominio HTTPS desde el que vayas a entrar.

Hasta que configures Firebase, la app sigue funcionando y guardando el progreso localmente. Tras iniciar sesión con Google, sube el progreso local si la cuenta está vacía y sincroniza con Firestore en los demás dispositivos. Usa **Mi progreso → Descargar copia de mis datos** para conservar una copia independiente.

La lista integrada corresponde al nivel 1 del programa HSK 3.0 y contiene 300 palabras; consulta el [programa oficial de HSK](https://hsk.cn-bj.ufileos.com/3.0/%E6%96%B0%E7%89%88HSK%E8%80%83%E8%AF%95%E5%A4%A7%E7%BA%B21219.pdf).

La práctica de trazos utiliza [Hanzi Writer](https://github.com/chanind/hanzi-writer), distribuido bajo licencia MIT, y su conjunto de datos de trazos.
