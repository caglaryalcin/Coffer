export function accountCreationDestination(originView: string, originGroup: string): {
  view: "all" | "favorites";
  group: string;
} {
  return {
    view: originView === "favorites" ? "favorites" : "all",
    group: originView === "all" ? originGroup : "All",
  };
}
