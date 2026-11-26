import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './lib/firebase';
import { applyCampaignTheme, DEFAULT_THEME } from './lib/themes';
import { subscribeOwnedCampaigns, subscribeUserMemberships } from './lib/vttService';
import type { Campaign, UserMembership } from './types/vtt';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthGate } from './components/AuthGate';
import { CampaignLobby } from './components/CampaignLobby';
import { GMWorkspace } from './views/GMWorkspace';
import { SecondScreenView } from './views/SecondScreenView';
import { PlayerMobileView } from './views/PlayerMobileView';
import { navigateToRoute, parseCurrentRoute, type RouteMatch } from './lib/router';

function FolioApp() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [route, setRoute] = useState<RouteMatch>(() => parseCurrentRoute());

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [memberships, setMemberships] = useState<UserMembership[]>([]);
  const [lobbyLoading, setLobbyLoading] = useState(true);

  function navigate(path: string) {
    setRoute(navigateToRoute(path));
  }

  useEffect(() => {
    const syncRoute = () => setRoute(parseCurrentRoute());
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('popstate', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('popstate', syncRoute);
    };
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
  }, []);

  // Reset to default "Papel e Tinta" theme when on Lobby or Auth screen
  useEffect(() => {
    if (route.view === 'lobby' || !user) {
      applyCampaignTheme(DEFAULT_THEME);
    }
  }, [route.view, user]);

  // Load user's campaigns and player memberships when signed in and on lobby
  useEffect(() => {
    if (!authReady || !user) {
      setCampaigns([]);
      setMemberships([]);
      setLobbyLoading(false);
      return;
    }
    if (route.view !== 'lobby') return;

    setLobbyLoading(true);
    const unsubCamps = subscribeOwnedCampaigns(user.uid, (list) => {
      setCampaigns(list);
      setLobbyLoading(false);
    });
    const unsubMems = subscribeUserMemberships(user.uid, setMemberships);
    return () => {
      unsubCamps();
      unsubMems();
    };
  }, [authReady, user, route.view]);

  if (!authReady) {
    return (
      <div className="min-h-screen vtt-canvas flex items-center justify-center">
        <p className="text-sm font-typewriter vtt-muted">Abrindo Folio...</p>
      </div>
    );
  }

  if (!user) {
    const subtitle =
      route.view === 'join' && route.param
        ? `Entre com sua conta Google para conectar seu celular à sala ${route.param} e acessar sua ficha.`
        : route.view === 'screen'
          ? 'Entre com a mesma conta do mestre para sincronizar a Tela dos Jogadores.'
          : undefined;
    return <AuthGate subtitle={subtitle} />;
  }

  if (route.view === 'screen' && route.param) {
    return <SecondScreenView campaignId={route.param} />;
  }

  if (route.view === 'join' && route.param) {
    return (
      <PlayerMobileView
        user={user}
        roomCode={route.param}
        onExit={() => navigate('/')}
      />
    );
  }

  if (route.view === 'play' && route.param) {
    return (
      <PlayerMobileView
        user={user}
        campaignId={route.param}
        onExit={() => navigate('/')}
      />
    );
  }

  if (route.view === 'table' && route.param) {
    return (
      <GMWorkspace
        user={user}
        campaignId={route.param}
        onExit={() => navigate('/')}
      />
    );
  }

  return (
    <CampaignLobby
      user={user}
      campaigns={campaigns}
      memberships={memberships}
      loading={lobbyLoading}
      onOpenCampaign={(id) => navigate(`/table/${id}`)}
      onOpenPlayerRoom={(id) => navigate(`/play/${id}`)}
    />
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <FolioApp />
    </ErrorBoundary>
  );
}
