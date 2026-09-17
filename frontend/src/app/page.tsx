import ProductToolbar from "../components/ProductToolbar";
import ScrollLoadGuard from "../components/ScrollLoadGuard";
import WorkspaceV3 from "../components/WorkspaceV3";

export default function HomePage() {
  return (
    <>
      <WorkspaceV3 />
      <ScrollLoadGuard />
      <ProductToolbar />
    </>
  );
}
