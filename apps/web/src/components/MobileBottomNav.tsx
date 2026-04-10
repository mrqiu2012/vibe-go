import React from "react";

export type MobilePage = "files" | "editor" | "terminal";

interface MobileBottomNavProps {
  currentPage: MobilePage;
  onNavigate: (page: MobilePage) => void;
  hasEditorContent: boolean;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  currentPage,
  onNavigate,
  hasEditorContent,
}) => {
  const navItems: { id: MobilePage; label: string; icon: string }[] = [
    { id: "files", label: "文件", icon: "📁" },
    ...(hasEditorContent ? [{ id: "editor" as MobilePage, label: "编辑", icon: "📝" }] : []),
    { id: "terminal", label: "终端", icon: "💻" },
  ];

  return (
    <nav className="mobileBottomNav">
      {navItems.map((item) => (
        <button
          key={item.id}
          className={`mobileNavItem ${currentPage === item.id ? "active" : ""}`}
          onClick={() => onNavigate(item.id)}
          aria-current={currentPage === item.id ? "page" : undefined}
        >
          <span className="mobileNavIcon">{item.icon}</span>
          <span className="mobileNavLabel">{item.label}</span>
        </button>
      ))}
    </nav>
  );
};
