'use strict';

const _ = require('underscore');
const parseGeoraster = require("georaster");

const get = require('../get/get');
const utils = require('../utils/utils');

const logger = require('../../logger');
const parse = require('mathjs').parse;

const regexMultiCharacter = /[A-z]{2}/g;

const isLeafNode = node => !node.op;

const variables = [...Array(13)].map((val, i) => String.fromCharCode(i + 65).toLowerCase());
const operations = {
  add: (a, b) => a + b,
  subtract: (a, b) => a - b,
  multiply: (a, b) => a * b,
  divide: (a, b) => a / b
};

const getValue = (input, bandValues) => {
  if (input.value) return input.value;

  const variableIndex = variables.findIndex(variable => variable === input.name);
  return bandValues[variableIndex];
};

const computeValue = (node, bandValues) => {
  const leftNode = node.args[0];
  const rightNode = node.args[1];

  const operation = node.fn;

  let leftValue;
  if (leftNode.content) { // if the node represents parentheses, it will be an object with a single property "content" which contains a node
    leftValue = computeValue(leftNode.content, bandValues);
  } else if (isLeafNode(leftNode)) {
    leftValue = getValue(leftNode, bandValues);
  } else {
    leftValue = computeValue(leftNode, bandValues);
  }

  let rightValue;
  if (rightNode.content) { // if the node represents parentheses, it will be an object with a single property "content" which contains a node
    rightValue = computeValue(rightNode.content, bandValues);
  } else if (isLeafNode(rightNode)) {
    rightValue = getValue(rightNode, bandValues);
  } else {
    rightValue = computeValue(rightNode, bandValues);
  }

  return operations[operation](leftValue, rightValue);
};

const getBandRows = (bands, index) => {
  // using a for loop here instead of map leads to a significant performance improvement
  const bandRows = [];
  for (let i = 0; i < bands.length; i++) {
    bandRows.push(bands[i][index]);
  }
  return bandRows;
};

const getBandValues = (bandRows, index) => {
  // using a for loop here instead of map leads to a significant performance improvement
  const bandValues = [];
  for (let i = 0; i < bandRows.length; i++) {
    bandValues.push(bandRows[i][index]);
  }
  return bandValues;
}

// pre-parse arithmetic string to catch limitations with arithmetic operations
// before attempting to compute
const arithmeticError = (arithmetic) => {
  if (arithmetic.match(regexMultiCharacter)) {
    return ('Geoblaze does not currently support implicit multiplication between variables. Please use the multiplication (*) symbol for these operations.');
  }
}

/**
 * The band arithmetic function takes a raster and an arithmetic operation written as
 * a string as input. The function performs pixel-by-pixel calculation according to the
 * arithmetic operation provided. This is only possible for a multiband raster and not
 * for single band rasters. The output is a computed single band raster.
 * @name band_arithmetic
 * @param {Object} raster - a raster from the georaster library
 * @param {String} operation - a string representation of a arithmetic operation to perform
 * @returns {Object} array of computed values for each band
 * @example
 * const ndvi = geoblaze.band_arithmetic(georaster, '(c - b)/(c + b)');
 */

module.exports = (georaster, arithmetic) => {
  return new Promise((resolve, reject) => {
    const parsedArithmetic = parse(arithmetic.toLowerCase());

    if (georaster.values.length < 2) {
      return reject(new Error('Band arithmetic is not available for this raster. Please make sure you are using a multi-band raster.'));
    }

    const parseError = arithmeticError(arithmetic);
    if (parseError) return reject(new Error(parseError));

    try {
      const bands = georaster.values;
      const values = [];

      for (let i = 0; i < bands[0].length; i++) {
        const bandRows = getBandRows(bands, i);
        const row = [];

        for (let j = 0; j < bandRows[0].length; j++) {
          const bandValues = getBandValues(bandRows, j);
          row.push(computeValue(parsedArithmetic, bandValues));
        }
        values.push(row);
      }

      const metadata = _.pick(georaster, ...[
        'no_data_value',
        'projection',
        'xmin',
        'ymax',
        'pixel_width',
        'pixel_height'
      ]);
      return parseGeoraster([values], metadata).then(georaster => resolve(georaster));

    } catch(e) {
      console.error(e);
      reject(e);
    }
  });
};