import React, { useState } from 'react';
import { useAppStore } from '../../stores/app-store';

export default function TopHeader() {
  const { toggleSettings } = useAppStore();
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  return (
    <header className="h-9 border-b border-gray-200 flex items-center px-3 text-xs bg-white shrink-0 select-none">
      <div className="flex items-center gap-4 text-gray-600">
        <span className="font-semibold text-gray-800">
          <span className="text-purple-600">Pig</span>Agent
        </span>
        <span>File</span>
        <span>Edit</span>
        <span>View</span>
        <span>Help</span>
      </div>
      <div className="flex-1 flex justify-center">
        <span className="text-gray-500">Nexa</span>
      </div>
      <div className="flex items-center gap-3 text-gray-500">
        <button
          onClick={() => { document.getElementById('leftSidebar')?.classList.toggle('hidden'); setLeftOpen(!leftOpen); }}
          className="hover:text-gray-800 transition"
        >☰</button>
        <button
          onClick={() => { document.getElementById('rightSidebar')?.classList.toggle('hidden'); setRightOpen(!rightOpen); }}
          className="hover:text-gray-800 transition"
        >◐</button>
        <div className="w-2 h-2 rounded-full bg-green-500" />
      </div>
    </header>
  );
}
