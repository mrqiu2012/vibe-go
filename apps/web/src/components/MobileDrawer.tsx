import React from "react";

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export const MobileDrawer: React.FC<MobileDrawerProps> = ({
  isOpen,
  onClose,
  title,
  children,
}) => {
  return (
    <>
      <div
        className={`mobileDrawerOverlay ${isOpen ? "open" : ""}`}
        onClick={onClose}
        aria-hidden={!isOpen}
      />
      <aside
        className={`mobileDrawer ${isOpen ? "open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mobileDrawerHeader">
          <h2 className="mobileDrawerTitle">{title}</h2>
          <button
            className="mobileDrawerClose"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div className="mobileDrawerContent">{children}</div>
      </aside>
    </>
  );
};
