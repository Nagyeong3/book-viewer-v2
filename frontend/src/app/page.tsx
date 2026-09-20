import IndexManagementPanel from "../components/IndexManagementPanel";
import ProductToolbar from "../components/ProductToolbar";
import WorkspaceV3 from "../components/WorkspaceV3";

export default function HomePage() {
  return (
    <>
      <WorkspaceV3 />
      <ProductToolbar />
      <IndexManagementPanel />
    </>
  );
}
