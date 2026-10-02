import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./host-contract";
import { listHostDirectory, removeHostPath, statHostPath } from "./src/host-listing";
import { searchHostInFiles } from "./src/host-search";

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    statPath: ({ rootPath, relativePath }) => statHostPath(rootPath, relativePath),
    listDirectory: ({ rootPath, relativePath, showSkipped, ignoredFolders }) =>
      listHostDirectory(rootPath, relativePath, showSkipped, ignoredFolders),
    searchInFiles: ({ rootPath, ignoredFolders, ...input }) =>
      searchHostInFiles(rootPath, input, new Set(ignoredFolders)),
    removePath: ({ rootPath, relativePath }) => removeHostPath(rootPath, relativePath),
  },
});
