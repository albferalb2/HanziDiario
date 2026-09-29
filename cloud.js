const FIREBASE_VERSION = '12.19.0';
const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

const config = window.HANZI_FIREBASE_CONFIG || {};
const required = ['apiKey', 'authDomain', 'projectId', 'appId'];
const configured = required.every(key => typeof config[key] === 'string' && config[key].trim());

if (!configured) {
  emit('hanzi-cloud-ready', { configured: false });
} else {
  try {
    const sdk = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    const [appSdk, authSdk, dbSdk] = await Promise.all([
      import(`${sdk}/firebase-app.js`),
      import(`${sdk}/firebase-auth.js`),
      import(`${sdk}/firebase-firestore.js`),
    ]);
    const app = appSdk.initializeApp(config);
    const auth = authSdk.getAuth(app);
    const db = dbSdk.getFirestore(app);
    const redirectPendingKey = 'hanzi-google-redirect-pending';
    let hadPendingRedirect = false;
    try { hadPendingRedirect = sessionStorage.getItem(redirectPendingKey) === '1'; } catch {}
    let currentUser = null;
    let writeTimer = null;
    let latestQueuedState = null;

    const userProgress = uid => dbSdk.doc(db, 'users', uid, 'progress', 'main');
    const syncError = error => {
      const message = error?.code === 'permission-denied'
        ? 'Firebase rechazó el acceso. Revisa las reglas de Firestore.'
        : error?.code === 'auth/unauthorized-domain'
          ? `Firebase no autoriza ${location.hostname}. Añádelo en Authentication → Settings → Authorized domains.`
          : error?.code === 'auth/operation-not-allowed'
            ? 'Activa Google en Firebase Authentication → Sign-in method.'
            : error?.code === 'auth/web-storage-unsupported'
              ? 'El navegador está bloqueando el almacenamiento de sesión. Abre Hanzi Diario en Safari o Chrome y permite el almacenamiento del sitio.'
              : error?.code === 'auth/network-request-failed'
                ? 'No se pudo completar el acceso. Comprueba la conexión a Internet e inténtalo otra vez.'
          : 'No se pudo sincronizar. Comprueba tu conexión y Firebase.';
      emit('hanzi-cloud-error', { message, code: error?.code });
    };
    const persistNow = async progress => {
      if (!currentUser) return;
      await dbSdk.setDoc(userProgress(currentUser.uid), {
        progress: JSON.parse(JSON.stringify(progress)),
        updatedAt: dbSdk.serverTimestamp(),
      });
    };

    window.hanziCloud = {
      async signIn() {
        const provider = new authSdk.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        const isMobile = matchMedia('(max-width: 760px)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
        if (isMobile) {
          try { sessionStorage.setItem(redirectPendingKey, '1'); } catch {}
          try { return await authSdk.signInWithRedirect(auth, provider); }
          catch (error) { try { sessionStorage.removeItem(redirectPendingKey); } catch {} throw error; }
        }
        return authSdk.signInWithPopup(auth, provider);
      },
      signOut: () => authSdk.signOut(auth),
      save(progress) {
        if (!currentUser) return;
        latestQueuedState = progress;
        clearTimeout(writeTimer);
        writeTimer = setTimeout(() => {
          const queued = latestQueuedState;
          persistNow(queued).catch(syncError);
        }, 350);
      },
    };

    await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);
    authSdk.getRedirectResult(auth).then(result => {
      try { sessionStorage.removeItem(redirectPendingKey); } catch {}
      if (hadPendingRedirect && !result?.user) setTimeout(() => {
        if (!currentUser) emit('hanzi-cloud-error', { message: 'Google volvió a Hanzi Diario sin completar el acceso. Revisa el dominio autorizado y la URL de redirección de Firebase.' });
      }, 2500);
    }).catch(error => {
      try { sessionStorage.removeItem(redirectPendingKey); } catch {}
      syncError(error);
    });
    authSdk.onAuthStateChanged(auth, async user => {
      currentUser = user;
      if (user) { try { sessionStorage.removeItem(redirectPendingKey); } catch {} }
      emit('hanzi-auth-state', { user: user ? { uid: user.uid, displayName: user.displayName, email: user.email, photoURL: user.photoURL } : null });
      if (!user) return;
      try {
      const snapshot = await dbSdk.getDoc(userProgress(user.uid));
      const local = window.hanziGetState?.();
        const belongsToAnotherAccount = Boolean(local?.cloudUid && local.cloudUid !== user.uid);
        if (!snapshot.exists()) {
          if (belongsToAnotherAccount) emit('hanzi-cloud-data', { reset: true, uid: user.uid });
          else if (local) {
            emit('hanzi-cloud-owner', { uid: user.uid });
            await persistNow({ ...local, cloudUid: user.uid });
          }
          return;
        }
        const documentData = snapshot.data();
        const remote = documentData.progress;
        const cloudTime = documentData.updatedAt?.toMillis?.() || Date.parse(remote?.updatedAt || '') || 0;
        const localTime = Date.parse(local?.updatedAt || '') || 0;
        if (remote && (belongsToAnotherAccount || cloudTime >= localTime)) emit('hanzi-cloud-data', { progress: remote, uid: user.uid });
        else if (local) {
          emit('hanzi-cloud-owner', { uid: user.uid });
          await persistNow({ ...local, cloudUid: user.uid });
        }
      } catch (error) { syncError(error); }
    });
    emit('hanzi-cloud-ready', { configured: true });
  } catch (error) {
    console.error('No se pudo inicializar Firebase:', error);
    emit('hanzi-cloud-ready', { configured: false, error: true });
    emit('hanzi-cloud-error', { message: `No se pudo cargar Firebase (${error?.code||error?.message||'error desconocido'}). La app sigue guardando el progreso en este dispositivo.` });
  }
}
