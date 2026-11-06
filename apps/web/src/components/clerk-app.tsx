'use client';
import { ClerkProvider, SignIn, SignUp, UserButton, useAuth } from '@clerk/react';
import { AuthenticatedApp } from './app-root';
import { AccountContext } from './account-control';
export default function ClerkApp({ publishableKey }: { publishableKey: string }) {
  return (
    <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
      <ClerkSession />
    </ClerkProvider>
  );
}
function ClerkSession() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const url = new URL(typeof window === 'undefined' ? 'http://localhost/' : window.location.href);
  const signingUp = url.searchParams.has('sign-up');
  url.searchParams.delete('sign-up');
  const signInURL = url.href;
  url.searchParams.set('sign-up', '1');
  const signIn =
    signingUp && url.searchParams.has('invite') ? (
      <SignUp routing="hash" signInUrl={signInURL} forceRedirectUrl={signInURL} />
    ) : (
      <SignIn
        routing="hash"
        signUpUrl={url.searchParams.has('invite') ? url.href : undefined}
        forceRedirectUrl={signInURL}
      />
    );
  return (
    <AccountContext.Provider value={<UserButton />}>
      <AuthenticatedApp
        isLoaded={isLoaded}
        isSignedIn={Boolean(isSignedIn)}
        getToken={getToken}
        signIn={signIn}
        local={false}
      />
    </AccountContext.Provider>
  );
}
