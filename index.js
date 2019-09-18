/* eslint-disable no-console */
// const ChangesStream = require('changes-stream');
const https = require('https');
const changes = require('concurrent-couch-follower');
const { createPackage, getNpmSyncSeq, updateNpmSyncSeq } = require('./db.js');

const dbUrl = 'https://replicate.npmjs.com';
const endless = true;
const patchSize = 100; // only applied if endless = false
const customElementsFile = 'custom-elements.json';

const aRequest = url =>
  new Promise((resolve, reject) => {
    https
      .get(url, resp => {
        let data = '';
        resp.on('data', chunk => {
          data += chunk;
        });

        resp.on('end', () => {
          resolve(data);
        });
      })
      .on('error', err => {
        reject(err.message);
      });
  });

function aTimeout(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function getNpmLastDbSeq() {
  const body = await aRequest(dbUrl);
  return JSON.parse(body).update_seq;
}

async function main() {
  const startSeq = await getNpmSyncSeq();
  const npmLastDbSeq = await getNpmLastDbSeq();
  const potentialEndSeq = startSeq + patchSize;
  const endSeq = potentialEndSeq < npmLastDbSeq ? potentialEndSeq : npmLastDbSeq;

  let active = true;

  async function syncWc(change) {
    if (active === false) {
      return;
    }
    console.log(`${change.seq}... processing`);
    if (change.deleted) {
      // TODO: handle deletion of packages
      return;
    }

    const pkg = change.doc;
    const version = Object.keys(pkg.versions)[Object.keys(pkg.versions).length - 1];
    const nameAtVersion = `${pkg.name}@${version}`;
    const url = `https://unpkg.com/${nameAtVersion}/${customElementsFile}`;

    let customElementsJsonString;
    // if unpkg does not have the package yet then wait/fetch with increasing intervales
    try {
      customElementsJsonString = await aRequest(url);
      if (customElementsJsonString === `Cannot find package ${nameAtVersion}`) {
        console.log('Starting to wait for unpkg');
        await aTimeout(10);
        customElementsJsonString = await aRequest(url);
      }
      if (customElementsJsonString === `Cannot find package ${nameAtVersion}`) {
        console.log('...more waiting for unpkg');
        await aTimeout(100);
        customElementsJsonString = await aRequest(url);
      }
      if (customElementsJsonString === `Cannot find package ${nameAtVersion}`) {
        console.log('... ... extreme waiting for unpkg');
        await aTimeout(1000);
        customElementsJsonString = await aRequest(url);
      }
      if (customElementsJsonString === `Cannot find package ${nameAtVersion}`) {
        console.log('!!! unpkg could not provide the package');
        return;
      }
    } catch (err) {
      console.log('!!! unpkg host unreachable');
      console.log(err);
    }

    if (customElementsJsonString === `Cannot find "/${customElementsFile}" in ${nameAtVersion}`) {
      console.log(`  ${pkg.name}@${version} !== Web Component // ignore`);
    }

    if (customElementsJsonString[0] === '{') {
      console.log(`----------------- ${pkg.name}@${version} === Web Component -----------------`);
      await createPackage(pkg, version, JSON.parse(customElementsJsonString));
    }
  }

  const dataHandler = (data, done) => {
    syncWc(data).then(() => {
      done();
    });
  };

  let stream;

  // for a new index the sequence to start/since from is 2877390 as this marks roughtly
  // the time/change the first `custom-element.json` got published to npm
  // second update after 2899795
  const configOptions = {
    db: dbUrl,
    include_docs: true,
    sequence: (seq, cb) => {
      if (endless === false && seq >= endSeq) {
        active = false;
      }
      updateNpmSyncSeq(seq)
        .then(() => {
          cb();
          console.log(`= ${seq} // start seq in case of failure`);
          if (endless === false && seq >= endSeq) {
            if (endSeq === npmLastDbSeq) {
              console.log('===> Up to date with latest npm changes');
            }
            stream.end();
            process.exit(0);
          }
        })
        .catch(err => {
          console.log('## Could not update npmlas', err);
        });
    },
    since: startSeq,
    concurrency: 5,
  };

  stream = changes(dataHandler, configOptions);
}

main()
  .then()
  .catch(err => {
    console.error(err);
  });
