{ pkgs, ... }:

{
  languages.javascript = {
    enable = true;
    yarn = {
      enable = true;
      install.enable = true;
    };
  };
  devcontainer.enable = true;
  difftastic.enable = true;
  pre-commit.hooks = {
    prettier.enable = true;
  };
}
