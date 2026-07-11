import React, { useEffect } from 'react';
import MainLayout from './components/layout/MainLayout';
import SettingsModal from './components/settings/SettingsModal';
import { useAppStore } from './stores/app-store';

export default function App() {
  const { initialized, init, settingsOpen } = useAppStore();

  useEffect(() => {
    init();
  }, []);

  if (!initialized) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400">Loading Nexa...</div>
      </div>
    );
  }

  return (
    <>
      <MainLayout />
      {settingsOpen && <SettingsModal />}
    </>
  );
}
