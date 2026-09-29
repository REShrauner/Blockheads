// Sign-in / request-access gate: tab switching, the two forms, sign-out,
// and the auth-state listener that boots the rest of the app once someone
// is signed in.
window.BlockheadsAuth = (function () {
  const B = window.Blockheads;

  const signInView = document.getElementById('sign-in-view');
  const appView = document.getElementById('app-view');

  const tabSignIn = document.getElementById('tab-sign-in');
  const tabRequest = document.getElementById('tab-request-access');
  const signInForm = document.getElementById('sign-in-form');
  const requestForm = document.getElementById('request-access-form');

  const signInEmail = document.getElementById('sign-in-email');
  const signInPassword = document.getElementById('sign-in-password');
  const signInError = document.getElementById('sign-in-error');

  const requestName = document.getElementById('request-name');
  const requestEmail = document.getElementById('request-email');
  const requestPassword = document.getElementById('request-password');
  const requestNote = document.getElementById('request-note');
  const requestError = document.getElementById('request-error');
  const requestSuccess = document.getElementById('request-success');

  const signOutButton = document.getElementById('sign-out-button');

  function showGate() {
    appView.hidden = true;
    signInView.hidden = false;
  }

  function showApp() {
    signInView.hidden = true;
    appView.hidden = false;
  }

  function switchTab(which) {
    const showingSignIn = which === 'sign-in';
    tabSignIn.setAttribute('aria-selected', String(showingSignIn));
    tabRequest.setAttribute('aria-selected', String(!showingSignIn));
    signInForm.hidden = !showingSignIn;
    requestForm.hidden = showingSignIn;
    signInError.hidden = true;
    requestError.hidden = true;
    requestSuccess.hidden = true;
  }

  tabSignIn.addEventListener('click', () => switchTab('sign-in'));
  tabRequest.addEventListener('click', () => switchTab('request-access'));

  signInForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    signInError.hidden = true;
    const submitButton = signInForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      const { error } = await window.supabaseClient.auth.signInWithPassword({
        email: signInEmail.value.trim(),
        password: signInPassword.value,
      });
      if (error) throw error;
      // onAuthStateChange below picks up the session and calls onSignedIn.
    } catch (err) {
      signInError.textContent = 'Could not sign in: ' + err.message;
      signInError.hidden = false;
    } finally {
      submitButton.disabled = false;
    }
  });

  requestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    requestError.hidden = true;
    requestSuccess.hidden = true;
    const submitButton = requestForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      const { error } = await window.supabaseClient.from('membership_requests').insert({
        name: requestName.value.trim(),
        email: requestEmail.value.trim(),
        password: requestPassword.value,
        note: requestNote.value.trim() || null,
      });
      if (error) throw error;
      requestForm.reset();
      requestSuccess.hidden = false;
    } catch (err) {
      requestError.textContent = 'Could not send request: ' + err.message;
      requestError.hidden = false;
    } finally {
      submitButton.disabled = false;
    }
  });

  signOutButton.addEventListener('click', async () => {
    await window.supabaseClient.auth.signOut();
  });

  window.supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      B.state.user = null;
      showGate();
      switchTab('sign-in');
      signInForm.reset();
      return;
    }
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
      if (!session.user) return;
      B.onSignedIn(session.user).then(showApp);
    }
  });

  return { showGate, showApp };
})();
