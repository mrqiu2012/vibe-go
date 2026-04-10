import React from "react";

interface MobileTopbarProps {
  projectName: string;
  onMenuClick: () => void;
  onSettingsClick?: () => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
}

export const MobileTopbar: React.FC<MobileTopbarProps> = ({
  projectName,
  onMenuClick,
  onSettingsClick,
  isDarkMode,
  onToggleDarkMode,
}) => {
  return (
    <header className="mobileTopbar">
      <button
        className="mobileMenuBtn"
        onClick={onMenuClick}
        aria-label="打开菜单"
      >
        ☰
      </button>
      
      <h1 className="mobileProjectName">{projectName || "未选择项目"}</h1>
      
      <div className="mobileTopActions">
        <button
          className="mobileIconBtn"
          onClick={onToggleDarkMode}
          aria-label={isDarkMode ? "切换到浅色模式" : "切换到深色模式"}
        >
          {isDarkMode ? "☀️" : "🌙"}
        </button>
        {onSettingsClick && (
          <button
            className="mobileIconBtn"
            onClick={onSettingsClick}
            aria-label="设置"
          >
            ⚙️
          </button>
        )}
      </div>
    </header>
  );
};
