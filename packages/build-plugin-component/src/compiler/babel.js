/**
 * @file generate es and lib by babel.
 * @author tony7lee
 */

const path = require('path');
const fs = require('fs-extra');
const glob = require('glob');
const babel = require('@babel/core');
const getRaxBabelConfig = require('rax-babel-config');
const { REG_JS, REG_D_TS } = require('../configs/reg');
const getCompileBabel = require('../utils/getCompileBabel');
const { analyzePackage } = require('./depAnalyze');
const generateStyle = require('./generateStyle');
const dtsCompiler = require('./dts');

const getBabelConfig = ({ target, componentLibs, rootDir, babelPlugins, babelOptions, type, alias }) => {
  const params = target === 'es' ? { modules: false } : {};
  let babelConfig;
  if (type === 'react') {
    babelConfig = getCompileBabel(params, { babelPlugins, babelOptions, rootDir });
  } else {
    babelConfig = getRaxBabelConfig({
      styleSheet: true,
      custom: {
        ignore: ['**/**/*.d.ts'],
      },
      ...params,
    });
    babelConfig.presets.push([require.resolve('@babel/preset-typescript'), { jsxPragma: 'createElement' }]);
  }
  // generate babel-plugin-import config
  const plugins = [];
  componentLibs.forEach(libraryName => {
    // check es folder if target is es
    const pluginOption = {
      libraryName,
      style: false, // style file will be require in style.js
    };
    if (target === 'es') {
      const libPath = path.join(rootDir, 'node_modules', libraryName, 'es');
      if (fs.existsSync(libPath)) {
        pluginOption.libraryDirectory = 'es';
      }
    }
    plugins.push([
      require.resolve('babel-plugin-import'),
      pluginOption,
      libraryName,
    ]);
  });
  babelConfig.plugins = babelConfig.plugins.concat(plugins);
  if (alias) {
    const aliasRelative = {};
    Object.keys(alias).forEach(aliasKey => {
      aliasRelative[aliasKey] = alias[aliasKey].startsWith('./') ? alias[aliasKey] : `./${alias[aliasKey]}`;
    });
    babelConfig.plugins = babelConfig.plugins.concat([[
      require.resolve('babel-plugin-module-resolver'),
      {
        root: ['./src'],
        alias: aliasRelative,
      },
    ]]);
  }
  return babelConfig;
};

module.exports = function babelCompiler(
  context,
  log,
  basicComponents,
  userOptions = {},
  type,
) {
  const { rootDir, pkg } = context;
  const { compilerOptions = {}, babelPlugins = [], babelOptions = [], alias, subComponents } = userOptions;
  // generate DTS for ts files, default is true
  const { declaration = true } = compilerOptions;
  const componentLibs = analyzePackage(pkg, basicComponents);
  const srcPath = path.join(rootDir, 'src');
  // compile task es and lib
  const compileTargets = ['es', 'lib'];
  const filesPath = glob.sync('**/*.*', { cwd: srcPath, ignore: ['node_modules/**', '*.d.ts'] });
  // traverse to compile the js files
  const compileInfo = [];
  compileTargets.forEach(target => {
    const destPath = path.join(rootDir, target);
    // clear dir
    fs.emptyDirSync(destPath);
    filesPath.forEach(filePath => {
      const sourceFile = path.join(srcPath, filePath);
      if (!REG_JS.test(filePath) || REG_D_TS.test(filePath)) {
        // copy file if it does not match REG_JS
        try {
          fs.copySync(sourceFile, path.join(destPath, filePath));
          log.info(`file ${filePath} copy successfully!`);
        } catch (err) {
          log.error(err);
        }
      } else {
        // get babel config for compile
        const libBabelConfig = getBabelConfig({
          target,
          componentLibs,
          rootDir,
          babelPlugins,
          babelOptions,
          type,
          alias,
        });
        // compile file by babel
        // TODO use context.babel
        const rightPath = filePath.replace(REG_JS, '.js');
        const { code } = babel.transformFileSync(sourceFile, {
          filename: rightPath,
          ...libBabelConfig,
        });
        const targetPath = path.join(destPath, rightPath);
        fs.ensureDirSync(path.dirname(targetPath));
        fs.writeFileSync(targetPath, code, 'utf-8');

        compileInfo.push({
          filePath,
          sourceFile,
          destPath,
        });
      }
    });

    if (type === 'react') {
      if (subComponents) {
        // filter dir in destPath folder
        const folderList = fs.readdirSync(destPath).filter((filePath) => {
          return fs.lstatSync(path.join(destPath, filePath)).isDirectory();
        });
        folderList.forEach((folder) => {
          generateStyle({ rootDir, basicComponents, destPath: path.join(destPath, folder), target, log, folder });
        });
      }
      generateStyle({ rootDir, basicComponents, destPath, target, log });
    }
  });
  // generate DTS for TS files
  if (declaration) {
    dtsCompiler(compileInfo, log);
  }
  log.info('Generate es and lib successfully!');
};
