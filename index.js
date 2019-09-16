/* eslint-disable */

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

async function getNpmLastDbSeq() {
  const body = await aRequest(dbUrl);
  return JSON.parse(body).update_seq;
}

async function main() {
  const startSeq = await getNpmSyncSeq();
  const npmLastDbSeq = await getNpmLastDbSeq();
  const potentialEndSeq = startSeq + patchSize;
  const endSeq = potentialEndSeq < npmLastDbSeq ? potentialEndSeq : npmLastDbSeq;

  const dataHandler = function(data, done) {
    syncWc(data).then(() => {
      done();
    });
  };

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

    const customElementsJsonString = await aRequest(url);
    if (customElementsJsonString !== `Cannot find "/${customElementsFile}" in ${nameAtVersion}`) {
      console.log(`----------------- ${pkg.name}@${version} === Web Component -----------------`);
      await createPackage(pkg, version, JSON.parse(customElementsJsonString));
    } else {
      console.log(`  ${pkg.name}@${version} !== Web Component // ignore`);
    }
  }

  let stream;

  // for a new index the sequence to start/since from is 2877390 as this marks roughtly
  // the time/change the first `custom-element.json` got published to npm
  const configOptions = {
    db: dbUrl,
    include_docs: true,
    sequence: function(seq, cb) {
      if (endless === false && seq >= endSeq) {
        active = false;
      }
      updateNpmSyncSeq(seq).then(() => {
        cb();
        console.log(`= ${seq} // start seq in case of failure`);
        if (endless === false && seq >= endSeq) {
          if (endSeq === npmLastDbSeq) {
            console.log('===> Up to date with latest npm changes');
          }
          stream.end();
          process.exit(0);
        }
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
