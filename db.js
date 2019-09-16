const { GraphQLClient } = require('graphql-request');

const endpoint = 'https://graphql.fauna.com/graphql';
const graphQLClient = new GraphQLClient(endpoint, {
  headers: {
    authorization: 'Bearer fnADYc2oY-ACAjR9EnRZT2RrGt5FifqJDpT2UM8H',
  },
});

async function getNpmSyncSeq() {
  const query = /* GraphQL */ `
    {
      findNpmSyncByID(id: "243701427429442053") {
        seq
        _id
      }
    }
  `;
  const data = await graphQLClient.request(query);
  return data.findNpmSyncByID.seq;
}

async function updateNpmSyncSeq(seq) {
  const query = /* GraphQL */ `
    mutation {
      updateNpmSync(id: "243701427429442053", data: { seq: ${seq} }) {
        seq
        _id
      }
    }
  `;
  await graphQLClient.request(query);
}

function getLibrary(deps) {
  if (Object.keys(deps).includes('lit-element')) {
    return { connect: '243701321298870785' }; // LitElement 2.x
  }

  return { connect: '243701293377389063' }; // HTMLElement
}

/**
 * Object => GraphQL query
 *
 * @param {mixed} obj
 * @return template string.
 */
const queryfy = obj => {
  if (typeof obj === 'number') {
    return obj;
  }

  if (Array.isArray(obj)) {
    const props = obj.map(value => `${queryfy(value)}`).join(',');
    return `[${props}]`;
  }

  if (typeof obj === 'object') {
    const props = Object.keys(obj)
      .map(key => `${key}:${queryfy(obj[key])}`)
      .join(',');
    return `{${props}}`;
  }

  return JSON.stringify(obj);
};

async function createPackage(pkg, version, rawCustomElements) {
  const library = getLibrary(pkg.versions[version].dependencies);
  const customElementsCreate = [];

  rawCustomElements.tags.forEach(tag => {
    const attributesCreate = [];
    tag.attributes.forEach(attribute => {
      const newAttribute = {
        name: attribute.name,
        type: attribute.type,
      };
      if (attribute.values) {
        newAttribute.values = { create: attribute.values };
      }
      attributesCreate.push(newAttribute);
    });
    const propertiesCreate = [];
    tag.properties.forEach(property => {
      const newProperty = {
        name: property.name,
        type: property.type,
      };
      if (property.attribute) {
        newProperty.attribute = property.attribute;
      }
      if (property.reflect) {
        newProperty.reflect = property.reflect;
      }
      if (property.values) {
        newProperty.values = { create: property.values };
      }
      propertiesCreate.push(newProperty);
    });

    const newTag = {
      name: tag.name,
      library,
      attributes: {
        create: attributesCreate,
      },
      properties: {
        create: propertiesCreate,
      },
    };
    customElementsCreate.push(newTag);
  });

  const data = {
    name: pkg.name,
    version,
    library,
    packageJsonString: JSON.stringify(pkg.versions[version]),
    customElementsString: JSON.stringify(rawCustomElements),
    customElements: {
      create: customElementsCreate,
    },
  };
  if (pkg.description) {
    data.description = pkg.description;
  }
  if (pkg.homepage) {
    data.homepage = pkg.homepage;
  }
  if (pkg.license) {
    data.license = pkg.license;
  }
  if (pkg.module) {
    data.module = pkg.module;
  }
  if (pkg.main) {
    data.main = pkg.main;
  }

  const query = `
    mutation createPackage {
      createPackage(
        data: ${queryfy(data)}
      ) {
        name
        _id
        customElements {
          data {
            name
            attributes {
              data {
                name
                type
              }
            }
            properties {
              data {
                name
                type
                attribute
                reflect
              }
            }
          }
        }
      }
    }
  `;
  console.log(`Adding Package ${pkg.name}@${version}`);
  rawCustomElements.tags.forEach(tag => {
    console.log(`Adding CustomElement ${tag.name}`);
  });
  console.log('---');
  await graphQLClient.request(query);
}

module.exports = {
  getNpmSyncSeq,
  updateNpmSyncSeq,
  createPackage,
};
