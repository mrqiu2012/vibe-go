import { useState, useCallback, useEffect, useRef } from "react";

export type MobilePage = "files" | "editor" | "terminal";

export interface MobileUIState {
  // 当前页面
  currentPage: MobilePage;
  // 导航到指定页面
  navigateTo: (page: MobilePage) => void;
  // 返回上一页
  goBack: () => void;
  // 页面历史
  pageHistory: MobilePage[];
  
  // 侧边抽屉
  isDrawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  
  // 快速操作栏
  isQuickActionsOpen: boolean;
  openQuickActions: () => void;
  closeQuickActions: () => void;
  
  // 键盘状态
  isKeyboardVisible: boolean;
  keyboardHeight: number;
  
  // 安全区域
  safeAreaTop: number;
  safeAreaBottom: number;
  
  // 手势滑动
  swipeDirection: "left" | "right" | null;
  handleSwipe: (direction: "left" | "right") => void;
}

export function useMobileUI(): MobileUIState {
  const [currentPage, setCurrentPage] = useState<MobilePage>("terminal");
  const [pageHistory, setPageHistory] = useState<MobilePage[]>(["terminal"]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isQuickActionsOpen, setIsQuickActionsOpen] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [safeAreaTop, setSafeAreaTop] = useState(0);
  const [safeAreaBottom, setSafeAreaBottom] = useState(0);
  const [swipeDirection, setSwipeDirection] = useState<"left" | "right" | null>(null);
  
  const lastPageRef = useRef<MobilePage>("terminal");

  // 导航到指定页面
  const navigateTo = useCallback((page: MobilePage) => {
    if (page !== currentPage) {
      lastPageRef.current = currentPage;
      setCurrentPage(page);
      setPageHistory((prev) => [...prev, page]);
    }
  }, [currentPage]);

  // 返回上一页
  const goBack = useCallback(() => {
    setPageHistory((prev) => {
      if (prev.length <= 1) return prev;
      const newHistory = prev.slice(0, -1);
      const previousPage = newHistory[newHistory.length - 1];
      setCurrentPage(previousPage);
      return newHistory;
    });
  }, []);

  // 抽屉操作
  const openDrawer = useCallback(() => setIsDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), []);

  // 快速操作栏
  const openQuickActions = useCallback(() => setIsQuickActionsOpen(true), []);
  const closeQuickActions = useCallback(() => setIsQuickActionsOpen(false), []);

  // 手势处理
  const handleSwipe = useCallback((direction: "left" | "right") => {
    setSwipeDirection(direction);
    
    // 根据当前页面和滑动方向决定行为
    if (direction === "right" && currentPage !== "files") {
      // 右滑返回文件列表
      navigateTo("files");
    } else if (direction === "left" && currentPage === "files") {
      // 左滑进入终端
      navigateTo("terminal");
    }
    
    // 重置滑动方向
    setTimeout(() => setSwipeDirection(null), 300);
  }, [currentPage, navigateTo]);

  // 监听键盘显示/隐藏
  useEffect(() => {
    const handleResize = () => {
      const visualViewport = window.visualViewport;
      if (visualViewport) {
        const heightDiff = window.innerHeight - visualViewport.height;
        const isVisible = heightDiff > 100;
        setIsKeyboardVisible(isVisible);
        setKeyboardHeight(isVisible ? heightDiff : 0);
      }
    };

    window.visualViewport?.addEventListener("resize", handleResize);
    return () => window.visualViewport?.removeEventListener("resize", handleResize);
  }, []);

  // 获取安全区域
  useEffect(() => {
    const updateSafeArea = () => {
      const styles = getComputedStyle(document.documentElement);
      const top = parseInt(styles.getPropertyValue("--mobile-safe-top") || "0", 10);
      const bottom = parseInt(styles.getPropertyValue("--mobile-safe-bottom") || "0", 10);
      setSafeAreaTop(top);
      setSafeAreaBottom(bottom);
    };

    updateSafeArea();
    window.addEventListener("resize", updateSafeArea);
    return () => window.removeEventListener("resize", updateSafeArea);
  }, []);

  // 监听物理返回键
  useEffect(() => {
    const handlePopState = () => {
      goBack();
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [goBack]);

  return {
    currentPage,
    navigateTo,
    goBack,
    pageHistory,
    isDrawerOpen,
    openDrawer,
    closeDrawer,
    isQuickActionsOpen,
    openQuickActions,
    closeQuickActions,
    isKeyboardVisible,
    keyboardHeight,
    safeAreaTop,
    safeAreaBottom,
    swipeDirection,
    handleSwipe,
  };
}
